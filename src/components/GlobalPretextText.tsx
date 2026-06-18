"use client";

import { prepareWithSegments } from "@chenglou/pretext";
import { useEffect, useRef } from "react";

const SKIP_SELECTOR = [
  "[data-pretext-ignore]",
  "[data-global-pretext-text]",
  "script",
  "style",
  "noscript",
  "template",
  "canvas",
  "svg",
  "[aria-live]",
  "[contenteditable='true']",
  "input",
  "textarea",
  "select",
  "option",
  "pre",
  "code",
  "kbd",
  "samp",
  ".sr-only",
  ".pretext-probe",
  ".pretext-stage",
  ".pretext-fallback",
  ".pretext-line",
  ".pretext-word",
].join(",");

const CONTROL_SELECTOR = [
  "button",
  "[role='button']",
  "a",
  "label",
  ".chip",
  ".t-mono",
  ".t-eyebrow",
  ".t-meta",
  ".pretext-controls",
  ".pretext-actions",
].join(",");

const HERO_SELECTOR = [
  "h1",
  ".t-h1",
  ".hero-title",
  ".per-word-hero",
  ".water-text",
].join(",");

function isVisibleText(text: string) {
  return text.trim().length > 0;
}

function shouldSkipNode(node: Text) {
  const parent = node.parentElement;
  if (!parent || !isVisibleText(node.nodeValue ?? "")) return true;
  if (parent.closest(SKIP_SELECTOR)) return true;
  return false;
}

function getFont(parent: Element) {
  const cs = window.getComputedStyle(parent);
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

function getTone(parent: Element) {
  if (parent.closest(CONTROL_SELECTOR)) return "control";
  if (parent.closest(HERO_SELECTOR)) return "hero";
  return "body";
}

function wrapTextNode(node: Text, indexRef: { current: number }) {
  if (shouldSkipNode(node)) return;

  const parent = node.parentElement;
  if (!parent) return;

  const source = node.nodeValue ?? "";
  const parts = source.split(/(\s+)/);
  const fragment = document.createDocumentFragment();
  const font = getFont(parent);
  const tone = getTone(parent);

  for (const part of parts) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      fragment.appendChild(document.createTextNode(part));
      continue;
    }

    const span = document.createElement("span");
    const index = indexRef.current++ % 97;
    span.className = "global-pretext-text";
    span.dataset.globalPretextText = "true";
    span.dataset.pretextTone = tone;
    span.textContent = part;
    span.style.setProperty("--pretext-index", String(index));
    span.style.setProperty("--pretext-weight", String(Math.min(1, Math.max(0.18, part.length / 13))));
    span.style.setProperty("--pretext-x", String((index % 9) - 4));
    span.style.setProperty("--pretext-y", String(((index * 3) % 11) - 5));
    span.style.setProperty("--pretext-r", String(((index * 5) % 13) - 6));

    try {
      prepareWithSegments(part, font);
      span.dataset.pretextMeasured = "true";
    } catch {
      span.dataset.pretextMeasured = "fallback";
    }

    fragment.appendChild(span);
  }

  node.replaceWith(fragment);
}

function scan(root: ParentNode, indexRef: { current: number }) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipNode(node as Text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of nodes) wrapTextNode(node, indexRef);
}

export default function GlobalPretextText() {
  const indexRef = useRef(0);

  useEffect(() => {
    document.body.dataset.pretextAllText = "true";

    const run = () => scan(document.body, indexRef);
    const initial = window.requestAnimationFrame(() => {
      const fontsReady = "fonts" in document ? document.fonts.ready : Promise.resolve();
      fontsReady.then(run);
    });
    let queued = 0;

    const observer = new MutationObserver((mutations) => {
      let shouldRun = false;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const text = mutation.target as Text;
          shouldRun = !shouldSkipNode(text);
        }
        if (mutation.type === "childList") {
          shouldRun = Array.from(mutation.addedNodes).some((node) => {
            if (node.nodeType === Node.TEXT_NODE) return !shouldSkipNode(node as Text);
            if (node.nodeType !== Node.ELEMENT_NODE) return false;
            return !(node as Element).matches(SKIP_SELECTOR);
          });
        }
        if (shouldRun) break;
      }

      if (!shouldRun || queued) return;
      queued = window.requestAnimationFrame(() => {
        queued = 0;
        run();
      });
    });

    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(initial);
      if (queued) window.cancelAnimationFrame(queued);
      observer.disconnect();
      delete document.body.dataset.pretextAllText;
    };
  }, []);

  return null;
}
