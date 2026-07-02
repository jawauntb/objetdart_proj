"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";

/**
 * /coin — a real gold coin you tilt, flip, and rub.
 *
 * A Saint-Benedict-style medal modelled in Three.js: a PBR gold cylinder with
 * engraved relief (a cross + protective letters on the face, a standing figure
 * on the reverse) carried as bump maps, lit by a studio environment so it
 * shimmers and throws hard specular glints as you move the phone (device
 * gyroscope) or drag it. Tap to flip; rub the surface for a shine sweep. Every
 * gesture answers with a metallic coin sound and, on motion, a light shimmer.
 */

// draw curved text along an arc of a circle
function textArc(
  ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number,
  radius: number, startDeg: number, endDeg: number, size: number, flip = false,
) {
  const chars = [...text];
  const total = (endDeg - startDeg) * (Math.PI / 180);
  const step = total / Math.max(1, chars.length - 1);
  ctx.save();
  ctx.font = `700 ${size}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  chars.forEach((ch, i) => {
    const a = startDeg * (Math.PI / 180) + step * i;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

// A grayscale relief canvas used as a bumpMap: mid grey ground, RAISED elements
// light, RECESSED (engraved) elements dark. face = "front" (cross) | "back"
// (St. Benedict standing figure). Rendered as a faithful high-fidelity vector
// rendition of the classic Saint-Benedict "Jubilee" medal.
function makeReliefTexture(face: "front" | "back"): THREE.CanvasTexture {
  const s = 2048;
  const c = document.createElement("canvas"); c.width = c.height = s;
  const x = c.getContext("2d")!;
  const C0 = s / 2;
  const G = s / 1024; // scale factor vs. the original 1024 layout
  // ground
  x.fillStyle = "#8a8a8a"; x.fillRect(0, 0, s, s);

  // ── raised rim ring with fine engraved grooves (both faces) ──
  x.lineWidth = 30 * G; x.strokeStyle = "#c6c6c6";
  x.beginPath(); x.arc(C0, C0, s * 0.462, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 5 * G; x.strokeStyle = "#3f3f3f";
  x.beginPath(); x.arc(C0, C0, s * 0.484, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(C0, C0, s * 0.441, 0, Math.PI * 2); x.stroke();
  // beaded inner border (denser, higher-relief dots)
  const beads = 132;
  for (let i = 0; i < beads; i++) {
    const a = (i / beads) * Math.PI * 2;
    const bx = C0 + Math.cos(a) * s * 0.404, by = C0 + Math.sin(a) * s * 0.404;
    const g = x.createRadialGradient(bx, by, 0, bx, by, 6 * G);
    g.addColorStop(0, "#ececec"); g.addColorStop(0.6, "#c4c4c4"); g.addColorStop(1, "#7d7d7d");
    x.fillStyle = g;
    x.beginPath(); x.arc(bx, by, 6 * G, 0, Math.PI * 2); x.fill();
  }
  // thin engraved circle just inside the beads
  x.lineWidth = 3 * G; x.strokeStyle = "#5a5a5a";
  x.beginPath(); x.arc(C0, C0, s * 0.386, 0, Math.PI * 2); x.stroke();

  if (face === "front") {
    // ── CROSS side ── rim legend of the Vade Retro Satana exorcism.
    // top arc: V R S N S M V   bottom arc: S M Q L I V B
    x.fillStyle = "#333";
    textArc(x, "V·R·S·N·S·M·V", C0, C0, s * 0.372, 202, 338, 40 * G);
    textArc(x, "S·M·Q·L·I·V·B", C0, C0, s * 0.372, 22, 158, 40 * G, true);
    // PAX in a little raised banner at top, IHS-style flourishes at the sides
    x.font = `700 ${44 * G}px Georgia, serif`; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = "#e2e2e2"; x.fillText("✦ PAX ✦", C0, C0 - s * 0.372 + 2);
    x.fillStyle = "#2c2c2c"; x.font = `700 ${44 * G}px Georgia, serif`;
    x.fillText("✦ PAX ✦", C0, C0 - s * 0.372);

    // radiating fine sunrays behind the cross, filling the field
    x.strokeStyle = "#9c9c9c"; x.lineWidth = 2 * G;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      x.beginPath();
      x.moveTo(C0 + Math.cos(a) * s * 0.10, C0 + Math.sin(a) * s * 0.10);
      x.lineTo(C0 + Math.cos(a) * s * 0.355, C0 + Math.sin(a) * s * 0.355); x.stroke();
    }

    // ── the cross itself: a slender pattée cross with flared ends ──
    const arm = s * 0.315, thick = s * 0.052;
    const drawCrossArm = (horiz: boolean) => {
      x.save();
      x.translate(C0, C0);
      if (horiz) x.rotate(Math.PI / 2);
      // tapered raised bar with flared (pattée) terminal
      x.fillStyle = "#e4e4e4";
      x.beginPath();
      x.moveTo(-thick / 2, 0); x.lineTo(-thick / 2, -arm + thick);
      x.lineTo(-thick * 0.95, -arm); x.lineTo(thick * 0.95, -arm);
      x.lineTo(thick / 2, -arm + thick); x.lineTo(thick / 2, 0);
      x.lineTo(-thick / 2, arm - thick);
      x.closePath();
      // draw both halves symmetric: simpler — full vertical bar with flares
      x.restore();
    };
    void drawCrossArm;
    // simpler robust construction: raised bars + flared caps + engraved outline
    x.fillStyle = "#e4e4e4";
    // vertical & horizontal bars
    x.fillRect(C0 - thick / 2, C0 - arm, thick, arm * 2);
    x.fillRect(C0 - arm, C0 - thick / 2, arm * 2, thick);
    // flared pattée terminals
    const flare = (cx: number, cy: number, horiz: boolean) => {
      x.save(); x.translate(cx, cy); if (horiz) x.rotate(Math.PI / 2);
      x.fillStyle = "#eaeaea"; x.beginPath();
      x.moveTo(-thick / 2, 0); x.lineTo(-thick * 1.05, -thick * 0.9);
      x.lineTo(thick * 1.05, -thick * 0.9); x.lineTo(thick / 2, 0); x.closePath(); x.fill();
      x.restore();
    };
    flare(C0, C0 - arm, false); flare(C0, C0 + arm, false);
    flare(C0 - arm, C0, true); flare(C0 + arm, C0, true);
    // engraved bevel outline on the bars
    x.strokeStyle = "#3a3a3a"; x.lineWidth = 4 * G;
    x.strokeRect(C0 - thick / 2, C0 - arm, thick, arm * 2);
    x.strokeRect(C0 - arm, C0 - thick / 2, arm * 2, thick);
    // inner engraved centre line for depth
    x.strokeStyle = "#b8b8b8"; x.lineWidth = 2 * G;
    x.beginPath(); x.moveTo(C0, C0 - arm + thick); x.lineTo(C0, C0 + arm - thick); x.stroke();
    x.beginPath(); x.moveTo(C0 - arm + thick, C0); x.lineTo(C0 + arm - thick, C0); x.stroke();

    // letters on the cross — vertical C S S M L (Crux Sacra Sit Mihi Lux),
    // horizontal N D S M D (Non Draco Sit Mihi Dux). Engraved (dark).
    x.fillStyle = "#232323"; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = `700 ${34 * G}px Georgia, serif`;
    const vs = ["C", "S", "S", "M", "L"];
    const span = arm * 2 - thick * 1.6;
    vs.forEach((ch, i) => x.fillText(ch, C0, C0 - arm + thick * 0.8 + (i * span) / 4));
    const hs = ["N", "D", "S", "M", "D"];
    hs.forEach((ch, i) => { if (i !== 2) x.fillText(ch, C0 - arm + thick * 0.8 + (i * span) / 4, C0); });
    // centre monogram letter where the arms meet
    x.font = `700 ${30 * G}px Georgia, serif`; x.fillText("S", C0, C0);

    // quadrant letters C S P B (Crux Sancti Patris Benedicti) in raised relief
    x.fillStyle = "#dcdcdc"; x.font = `800 ${58 * G}px Georgia, serif`;
    const q = s * 0.205;
    const quad = (ch: string, dx: number, dy: number) => {
      x.fillStyle = "#2b2b2b"; x.fillText(ch, C0 + dx + 2, C0 + dy + 2); // shadow
      x.fillStyle = "#e6e6e6"; x.fillText(ch, C0 + dx, C0 + dy);         // raised
    };
    quad("C", -q, -q); quad("S", q, -q); quad("P", -q, q); quad("B", q, q);
  } else {
    // ── FIGURE side ── St. Benedict standing, cross in right hand, Rule in
    // left, poisoned cup + raven at his feet. Rim legend of the death prayer.
    x.fillStyle = "#333";
    textArc(x, "EIVS·IN·OBITV·NOSTRO", C0, C0, s * 0.370, 200, 340, 34 * G);
    textArc(x, "PRÆSENTIA·MVNIAMVR", C0, C0, s * 0.370, 20, 160, 32 * G, true);
    // exergue label under the figure
    x.font = `700 ${26 * G}px Georgia, serif`; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = "#2c2c2c"; x.fillText("EX·SM·CASINO·MDCCCLXXX", C0, C0 + s * 0.325);
    // PAX cartouche at the very top
    x.font = `700 ${40 * G}px Georgia, serif`;
    x.fillStyle = "#e2e2e2"; x.fillText("✦ PAX ✦", C0, C0 - s * 0.372 + 2);
    x.fillStyle = "#2c2c2c"; x.fillText("✦ PAX ✦", C0, C0 - s * 0.372);

    // sunburst glory behind the saint
    x.strokeStyle = "#a6a6a6"; x.lineWidth = 3 * G;
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2;
      x.beginPath();
      x.moveTo(C0 + Math.cos(a) * s * 0.085, C0 - s * 0.02 + Math.sin(a) * s * 0.085);
      x.lineTo(C0 + Math.cos(a) * s * 0.30, C0 - s * 0.02 + Math.sin(a) * s * 0.30); x.stroke();
    }

    // pedestal / ground the saint stands on
    x.fillStyle = "#cfcfcf"; x.strokeStyle = "#3a3a3a"; x.lineWidth = 4 * G;
    x.fillRect(C0 - 210 * G, C0 + 300 * G, 420 * G, 46 * G);
    x.strokeRect(C0 - 210 * G, C0 + 300 * G, 420 * G, 46 * G);

    // robed standing figure
    x.fillStyle = "#d8d8d8"; x.strokeStyle = "#333"; x.lineWidth = 5 * G;
    x.beginPath();
    x.moveTo(C0 - 130 * G, C0 + 300 * G);
    x.lineTo(C0 - 78 * G, C0 - 150 * G);
    x.quadraticCurveTo(C0, C0 - 210 * G, C0 + 78 * G, C0 - 150 * G);
    x.lineTo(C0 + 130 * G, C0 + 300 * G);
    x.closePath(); x.fill(); x.stroke();
    // robe fold lines (engraved)
    x.strokeStyle = "#9a9a9a"; x.lineWidth = 3 * G;
    for (const off of [-55, -18, 20, 58]) {
      x.beginPath(); x.moveTo(C0 + off * G, C0 - 120 * G);
      x.quadraticCurveTo(C0 + off * 1.4 * G, C0 + 90 * G, C0 + off * 1.9 * G, C0 + 290 * G); x.stroke();
    }
    // cowl / shoulders
    x.fillStyle = "#d0d0d0"; x.strokeStyle = "#333"; x.lineWidth = 4 * G;
    x.beginPath();
    x.moveTo(C0 - 82 * G, C0 - 120 * G);
    x.quadraticCurveTo(C0, C0 - 175 * G, C0 + 82 * G, C0 - 120 * G);
    x.quadraticCurveTo(C0, C0 - 95 * G, C0 - 82 * G, C0 - 120 * G);
    x.fill(); x.stroke();
    // head + halo
    x.fillStyle = "#dcdcdc";
    x.beginPath(); x.arc(C0, C0 - 205 * G, 42 * G, 0, Math.PI * 2); x.fill(); x.stroke();
    x.lineWidth = 4 * G; x.strokeStyle = "#4a4a4a";
    x.beginPath(); x.arc(C0, C0 - 210 * G, 60 * G, 0, Math.PI * 2); x.stroke();

    // tall cross in his (viewer-left) hand
    x.strokeStyle = "#e0e0e0"; x.lineCap = "round";
    x.lineWidth = 13 * G;
    x.beginPath(); x.moveTo(C0 - 168 * G, C0 - 250 * G); x.lineTo(C0 - 168 * G, C0 + 250 * G); x.stroke();
    x.beginPath(); x.moveTo(C0 - 210 * G, C0 - 170 * G); x.lineTo(C0 - 126 * G, C0 - 170 * G); x.stroke();
    x.lineCap = "butt";
    // the Holy Rule (book) in his other hand
    x.fillStyle = "#cfcfcf"; x.strokeStyle = "#333"; x.lineWidth = 4 * G;
    x.fillRect(C0 + 118 * G, C0 - 30 * G, 92 * G, 118 * G);
    x.strokeRect(C0 + 118 * G, C0 - 30 * G, 92 * G, 118 * G);
    x.beginPath(); x.moveTo(C0 + 164 * G, C0 - 30 * G); x.lineTo(C0 + 164 * G, C0 + 88 * G); x.stroke();
    x.strokeStyle = "#8a8a8a"; x.lineWidth = 2 * G;
    for (const ry of [-8, 6, 20, 34, 48, 62]) {
      x.beginPath(); x.moveTo(C0 + 126 * G, C0 + ry * G); x.lineTo(C0 + 158 * G, C0 + ry * G); x.stroke();
      x.beginPath(); x.moveTo(C0 + 170 * G, C0 + ry * G); x.lineTo(C0 + 202 * G, C0 + ry * G); x.stroke();
    }

    // poisoned cup with a serpent (viewer-left, at his feet)
    x.strokeStyle = "#333"; x.lineWidth = 4 * G; x.fillStyle = "#cbcbcb";
    x.beginPath();
    x.moveTo(C0 - 250 * G, C0 + 180 * G); x.lineTo(C0 - 205 * G, C0 + 260 * G);
    x.lineTo(C0 - 165 * G, C0 + 260 * G); x.lineTo(C0 - 120 * G, C0 + 180 * G);
    x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.arc(C0 - 185 * G, C0 + 285 * G, 16 * G, 0, Math.PI * 2); x.stroke(); // foot
    // serpent rising from the cup
    x.strokeStyle = "#e0e0e0"; x.lineWidth = 6 * G; x.lineCap = "round";
    x.beginPath();
    x.moveTo(C0 - 185 * G, C0 + 180 * G);
    x.quadraticCurveTo(C0 - 240 * G, C0 + 120 * G, C0 - 190 * G, C0 + 96 * G);
    x.quadraticCurveTo(C0 - 150 * G, C0 + 78 * G, C0 - 200 * G, C0 + 60 * G); x.stroke();
    x.lineCap = "butt";

    // raven with a morsel of bread (viewer-right, at his feet)
    x.fillStyle = "#cbcbcb"; x.strokeStyle = "#333"; x.lineWidth = 3 * G;
    x.beginPath();
    x.ellipse(C0 + 175 * G, C0 + 245 * G, 46 * G, 24 * G, -0.3, 0, Math.PI * 2);
    x.fill(); x.stroke();
    x.beginPath(); x.arc(C0 + 205 * G, C0 + 220 * G, 16 * G, 0, Math.PI * 2); x.fill(); x.stroke(); // head
    x.beginPath(); x.moveTo(C0 + 220 * G, C0 + 218 * G); x.lineTo(C0 + 246 * G, C0 + 224 * G);
    x.lineTo(C0 + 220 * G, C0 + 230 * G); x.closePath(); x.fill(); x.stroke(); // beak
    x.beginPath(); x.moveTo(C0 + 150 * G, C0 + 235 * G); x.lineTo(C0 + 120 * G, C0 + 210 * G);
    x.lineTo(C0 + 150 * G, C0 + 250 * G); x.closePath(); x.fill(); x.stroke(); // wing
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// milled / reeded coin edge
function makeReedTexture(): THREE.CanvasTexture {
  const w = 2048, h = 64;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  x.fillStyle = "#8a8a8a"; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 220; i++) {
    const px = (i / 220) * w;
    x.fillStyle = i % 2 ? "#c8c8c8" : "#585858";
    x.fillRect(px, 0, w / 220, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

// a 4-point star glint sprite (additive) for the "shine" pop
function makeStarTexture(): THREE.CanvasTexture {
  const s = 256; const c = document.createElement("canvas"); c.width = c.height = s;
  const x = c.getContext("2d")!; const C0 = s / 2;
  const g = x.createRadialGradient(C0, C0, 0, C0, C0, C0);
  g.addColorStop(0, "rgba(255,255,245,1)"); g.addColorStop(0.12, "rgba(255,246,210,0.9)");
  g.addColorStop(0.4, "rgba(255,220,140,0.15)"); g.addColorStop(1, "rgba(255,220,140,0)");
  x.fillStyle = g; x.beginPath(); x.arc(C0, C0, C0, 0, Math.PI * 2); x.fill();
  x.strokeStyle = "rgba(255,252,235,0.95)"; x.lineWidth = 3;
  for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    const len = a % (Math.PI / 2) === 0 ? C0 * 0.98 : C0 * 0.5;
    x.beginPath(); x.moveTo(C0 - Math.cos(a) * len, C0 - Math.sin(a) * len);
    x.lineTo(C0 + Math.cos(a) * len, C0 + Math.sin(a) * len); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export default function Coin() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    try { getFieldAudio().setAmbientProfile("light"); } catch { /* noop */ }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false; // we draw the aventurine background pass first
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:grab";

    const scene = new THREE.Scene();
    scene.background = null; // the background is the aventurine shader pass below
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.02);
    scene.environment = envRT.texture;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 23);

    // ── aventurine "night sky" background ─────────────────────────────────
    // A fullscreen shader that starts as dusk-dark and, as you play with the
    // coin, fills bottom-to-top with a deep-navy aventurine starfield (gold /
    // copper / blue-white flecks). Once full it sparkles ever brighter and
    // drifts iridescent — a wordless score of how much you've played.
    const bgScene = new THREE.Scene();
    const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const bgUniforms = {
      uTime: { value: 0 },
      uFill: { value: 0 },   // 0→1, how far the aventurine has risen
      uSpark: { value: 0 },  // live sparkle/iridescence intensity
      uAspect: { value: 1 },
    };
    const bgMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: bgUniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform float uTime, uFill, uSpark, uAspect;
        float hash(vec2 p){ p = fract(p*vec2(123.34,345.45)); p += dot(p,p+34.345); return fract(p.x*p.y); }
        // one twinkling fleck layer
        void layer(vec2 uv, float scale, float thresh, float seed, inout float acc, inout vec3 col){
          vec2 gv = vec2(uv.x*uAspect, uv.y) * scale;
          vec2 id = floor(gv);
          vec2 off = vec2(hash(id+seed+1.3), hash(id+seed+2.7)) - 0.5;
          float d = length(fract(gv) - 0.5 - off*0.7);
          float h = hash(id + seed);
          float star = smoothstep(0.14, 0.0, d) * step(thresh, h);
          float tw = 0.55 + 0.45*sin(uTime*(1.2 + h*3.0) + h*30.0);
          float b = star * mix(0.5, 1.0, tw) * mix(0.8, 2.4, uSpark);
          // fleck colour: vivid gold, sapphire, and copper — saturated, never white
          vec3 c = mix(vec3(1.0,0.78,0.30), vec3(0.42,0.62,1.0), hash(id+seed+7.1));
          c = mix(c, vec3(1.0,0.46,0.16), step(0.86, hash(id+seed+3.3)));
          // as you keep playing, each fleck flashes its own jewel hue (iridescent carats)
          vec3 jewel = 0.5 + 0.5*cos(6.2831*(vec3(0.0,0.33,0.67) + hash(id+seed+5.5)*3.0 + uTime*0.5));
          c = mix(c, jewel, uSpark*0.55);
          acc += b; col += c * b;
        }
        void main(){
          vec2 uv = vUv;
          // pure black before the night fills in
          vec3 dusk = vec3(0.0);
          // deep-navy aventurine base, darker toward the top of the sky
          vec3 avn = mix(vec3(0.028,0.050,0.135), vec3(0.014,0.022,0.070), uv.y);
          // the night rises from the bottom; soft transition band
          float band = 0.16;
          float fillAmt = 1.0 - smoothstep(uFill - band, uFill + band, uv.y);
          // a warm ember line at the rising horizon (sunset → night)
          float horizon = exp(-pow((uv.y - uFill)/0.045, 2.0)) * (1.0 - uFill*0.7) * step(0.02, uFill);
          vec3 sunset = vec3(0.40,0.16,0.05) * horizon;
          // starfield (only within the filled region)
          float acc = 0.0; vec3 scol = vec3(0.0);
          layer(uv, 70.0,  0.55, 0.0,  acc, scol);
          layer(uv, 130.0, 0.62, 17.0, acc, scol);
          layer(uv, 220.0, 0.72, 41.0, acc, scol);
          // roll off the brightest flecks so they read as vivid carats, never white
          float m = max(scol.r, max(scol.g, scol.b));
          scol = scol / (1.0 + m * 0.6);
          vec3 col = mix(dusk, avn, fillAmt) + sunset + scol * fillAmt;
          // gentle vignette
          float vig = smoothstep(1.25, 0.25, length((uv-0.5)*vec2(uAspect,1.0)));
          col *= mix(0.82, 1.0, vig);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
    bgQuad.frustumCulled = false;
    bgScene.add(bgQuad);

    // ── lighting: env + a hard key that makes gold flare ──
    const key = new THREE.DirectionalLight(0xfff4e2, 3.4);
    key.position.set(-8, 10, 12); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe6b0, 1.6);
    rim.position.set(9, -6, 8); scene.add(rim);
    scene.add(new THREE.AmbientLight(0x40381f, 0.5));

    // ── the coin ──
    const R = 6, TH = 0.66;
    const gold = { color: 0xE9B23A, metalness: 1 };
    const frontTex = makeReliefTexture("front");
    const backTex = makeReliefTexture("back");
    const reedTex = makeReedTexture(); reedTex.repeat.set(56, 1);
    const matFront = new THREE.MeshStandardMaterial({ ...gold, roughness: 0.22, bumpMap: frontTex, bumpScale: 8.5 });
    const matBack = new THREE.MeshStandardMaterial({ ...gold, roughness: 0.22, bumpMap: backTex, bumpScale: 8.5 });
    const matEdge = new THREE.MeshStandardMaterial({ ...gold, roughness: 0.34, bumpMap: reedTex, bumpScale: 3 });
    const geo = new THREE.CylinderGeometry(R, R, TH, 220, 1, false);
    geo.rotateX(Math.PI / 2); // faces point ±Z (toward camera)
    const coin = new THREE.Mesh(geo, [matEdge, matFront, matBack]); // side, +Z cap (front, faces camera), -Z cap (back)
    coin.castShadow = true;
    const coinGroup = new THREE.Group();
    coinGroup.add(coin);
    scene.add(coinGroup);

    // shine star sprite in front of the coin
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeStarTexture(), blending: THREE.AdditiveBlending, transparent: true, depthTest: false, opacity: 0 }));
    star.scale.set(10, 10, 1); star.position.set(-2.4, 2.4, 6); scene.add(star);

    // ── interaction state ──
    const tilt = { x: 0, y: 0, tx: 0, ty: 0 };     // eased vs target rotation from tilt/drag
    const flip = {                                 // directional flip (quaternion)
      q0: new THREE.Quaternion(),                  // orientation at flip start
      q1: new THREE.Quaternion(),                  // target orientation
      base: new THREE.Quaternion(),                // current settled/animating orientation
      t: 1,                                         // 0→1 progress (1 = settled)
    };
    const shine = { v: 0 };                        // star glint strength
    const size = { v: 1, t: 1 };                   // coin scale (lateral slide → resize)
    const drag = { on: false, px: 0, py: 0, moved: 0, downT: 0, lastRub: 0 };
    const spin = { z: 0 };                         // two-finger in-plane rotation (radians)
    const pointers = new Map<number, { x: number; y: number }>();
    const gesture = { two: false, twoAngle: null as number | null };
    const notes = { tiltSec: -1, tiltT: 0, spinSec: 999 }; // note-sweep trackers
    const _flipAxis = new THREE.Vector3();
    const _flipQ = new THREE.Quaternion();
    const _qTilt = new THREE.Quaternion();
    const _qSpin = new THREE.Quaternion();
    const _tiltEuler = new THREE.Euler();
    const _z = new THREE.Vector3(0, 0, 1);

    // ── aventurine "points": every interaction fills the night sky a little,
    //    persisted locally (no login) so it resumes where you left off ──
    const FILL_KEY = "objetdart:coin:aventurine";
    const fill = { v: 0, t: 0, spark: 0, save: 0 };
    try {
      const s = parseFloat(localStorage.getItem(FILL_KEY) || "0");
      if (s > 0) { fill.t = Math.min(1, s); fill.v = fill.t; }
    } catch { /* noop */ }
    const addPoints = (a: number) => {
      fill.t = Math.min(1, fill.t + a);            // monotonic progress (the "score")
      fill.spark = Math.min(1, fill.spark + a * 1.6 + 0.05); // live dazzle
      const now = performance.now();
      if (now - fill.save > 700) { fill.save = now; try { localStorage.setItem(FILL_KEY, fill.t.toFixed(3)); } catch { /* noop */ } }
    };

    // ── audio: the coin is an 8-note instrument (a C-major octave) ──
    const A = () => getFieldAudio();
    const SCALE = [60, 62, 64, 65, 67, 69, 71, 72]; // C4..C5 — do re mi fa sol la ti do
    // small coin → brighter/higher, big coin → lower "boing"; ~±1 octave
    const sizeShift = () => Math.round((1 - size.v) * 9);
    // one note, voiced for the current coin size. Big: adds a low brass/gong
    // weight + bell shimmer (Chinese-drum heft). Small: adds a bright upper
    // octave. Metallic either way.
    const voice = (midi: number, dur = 240) => {
      try {
        const a = A(); const m = midi + sizeShift();
        a.playNote(m, dur);
        if (size.v > 1.35) { a.playNote(m - 12, Math.round(dur * 1.5)); a.bell(); }
        else if (size.v < 0.8) { a.playNote(m + 12, Math.max(60, Math.round(dur * 0.5))); }
      } catch { /* noop */ }
    };
    // screen-space angle → one of 8 sectors, centred on the 8 compass directions
    const sectorOf = (dx: number, dy: number) => {
      let a = Math.atan2(dy, dx);                  // dy up-positive
      a = (a + Math.PI * 2 + Math.PI / 8) % (Math.PI * 2);
      return Math.floor(a / (Math.PI / 4)) % 8;
    };
    const coinCenter = () => {
      const r = renderer.domElement.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    };
    const ting = () => { try { A().bell(); } catch { /* noop */ } };     // metallic coin click
    const regionNote = (sec: number) => voice(SCALE[sec], 260);         // tap → root
    const tiltNote = (sec: number) => voice(SCALE[sec] + 7, 220);       // tilt → fifth (concordant)
    const spinNote = (sec: number) => voice(SCALE[sec] + 12, 200);      // rotate → octave (concordant)
    const flipSound = () => { try { const a = A(); const s = sizeShift(); a.playNote(79 + s, 60); window.setTimeout(() => a.playNote(86 + s, 50), 90); } catch { /* noop */ } };
    let lastShimmer = 0;
    const shimmer = (now: number, pitch: number, gap = 150) => {         // continuous-motion sparkle (unchanged character)
      if (now - lastShimmer < gap) return; lastShimmer = now;
      try { A().playNote(90 + (pitch % 8), 30); } catch { /* noop */ }
    };

    // Flip the coin, tumbling toward (dirX, dirY) in screen space (dirY up+).
    const doFlip = (dirX = 0, dirY = 1) => {
      const len = Math.hypot(dirX, dirY) || 1;
      const nx = dirX / len, ny = dirY / len;
      _flipAxis.set(ny, -nx, 0);                    // in-plane axis ⟂ to the flip direction
      _flipQ.setFromAxisAngle(_flipAxis, Math.PI);  // 180° → shows the other face
      flip.q0.copy(flip.base);
      flip.q1.copy(_flipQ).multiply(flip.base);     // world-space flip
      flip.t = 0;
      shine.v = 1; flipSound(); haptics.roll(); addPoints(0.035);
      useField.getState().recordTape("sigil", 0.9, "coin/flip");
      if (hintRef.current) hintRef.current.style.opacity = "0";
    };
    // motion-driven flip (pop / sudden tilt) — debounced, plays the concordant note
    let lastMotionFlip = 0;
    const motionFlip = (dirX: number, dirY: number, now: number) => {
      if (now - lastMotionFlip < 700) return;
      lastMotionFlip = now;
      tiltNote(sectorOf(dirX, dirY));
      doFlip(dirX, dirY);
    };

    // ── pointer: 1-finger slide=resize / vertical=tilt / rub=shine, tap=flip;
    //    2-finger twist = rotate the coin in-plane (and sweep the octave notes) ──
    const twoAngle = () => {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) return gesture.twoAngle ?? 0;
      return Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    };
    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      renderer.domElement.setPointerCapture?.(e.pointerId);
      if (pointers.size >= 2) { gesture.two = true; gesture.twoAngle = twoAngle(); drag.on = false; }
      else { drag.on = true; drag.px = e.clientX; drag.py = e.clientY; drag.moved = 0; drag.downT = performance.now(); }
      renderer.domElement.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // two-finger twist → in-plane rotation; each 45° crossing rings a note
      if (gesture.two && pointers.size >= 2) {
        const ang = twoAngle();
        if (gesture.twoAngle !== null) {
          let d = ang - gesture.twoAngle;
          while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          spin.z += d;
          const sec = (((Math.floor(spin.z / (Math.PI / 4)) % 8) + 8) % 8);
          if (sec !== notes.spinSec) { notes.spinSec = sec; spinNote(sec); haptics.tap(); shine.v = Math.min(1, shine.v + 0.25); addPoints(0.02); }
        }
        gesture.twoAngle = ang;
        return;
      }
      if (!drag.on) return;
      const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
      drag.px = e.clientX; drag.py = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      // lateral / diagonal slide → resize the coin; vertical → tilt (pitch)
      size.t = Math.max(0.5, Math.min(2.4, size.t + dx * 0.004));
      tilt.tx += dy * 0.006;   // pitch
      tilt.tx = Math.max(-1.1, Math.min(1.1, tilt.tx));
      const now = performance.now();
      const speed = Math.abs(dx) + Math.abs(dy);
      if (speed > 3) { shine.v = Math.min(1, shine.v + speed * 0.02); shimmer(now, Math.round(e.clientX / 40), 90); addPoints(0.005); if (now - drag.lastRub > 120) { haptics.tap(); drag.lastRub = now; } }
    };
    const onUp = (e: PointerEvent) => {
      const wasTwo = gesture.two;
      pointers.delete(e.pointerId);
      renderer.domElement.releasePointerCapture?.(e.pointerId);
      if (pointers.size < 2) { gesture.two = false; gesture.twoAngle = null; }
      renderer.domElement.style.cursor = "grab";
      if (wasTwo) { drag.on = false; return; }        // twist gesture — never a tap
      if (!drag.on) return; drag.on = false;
      const dt = performance.now() - drag.downT;
      if (drag.moved < 8 && dt < 400) {
        // tap flips toward where you pressed & rings that region's note
        const { cx, cy } = coinCenter();
        const dx = e.clientX - cx, dy = cy - e.clientY;    // up-positive
        const sec = sectorOf(dx, dy);
        ting(); regionNote(sec); shine.v = 1; haptics.tap();
        useField.getState().recordTape("object", 0.6, "coin/tap");
        doFlip(dx, dy);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointercancel", onUp);

    // ── device gyroscope (tilt the phone) ──
    let haveOrient = false;
    let prevGamma: number | null = null, prevBeta: number | null = null;
    const onOrient = (e: DeviceOrientationEvent) => {
      haveOrient = true;
      const gamma = e.gamma ?? 0, beta = e.beta ?? 0;
      tilt.ty = Math.max(-1.2, Math.min(1.2, gamma / 40));       // left/right
      tilt.tx = Math.max(-1.2, Math.min(1.2, (beta - 35) / 40)); // front/back
      if (prevGamma !== null && prevBeta !== null) {
        const dG = gamma - prevGamma, dB = beta - prevBeta;
        // a sudden tilt (fast orientation change) flips the coin that way
        if (Math.hypot(dG, dB) > 11) motionFlip(dG, -dB, performance.now());
      }
      prevGamma = gamma; prevBeta = beta;
    };
    window.addEventListener("deviceorientation", onOrient);

    // ── pop / jerk the phone → flip the coin toward the pop direction ──
    // watch for a sharp spike in linear acceleration; motionFlip debounces so
    // the pop and its rebound (decel) don't fire twice.
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.acceleration ?? e.accelerationIncludingGravity;
      if (!a) return;
      const ax = a.x ?? 0, ay = a.y ?? 0, az = a.z ?? 0;
      const mag = Math.hypot(ax, ay, az);
      const now = performance.now();
      // a hard pop in any direction (or a sharp jerk), well above normal handling
      if (mag > 20 || Math.abs(ax) > 15 || Math.abs(ay) > 15) {
        shine.v = 1; haptics.chop();
        motionFlip(ax, ay, now); // tumbles toward the pop direction
      }
    };
    window.addEventListener("devicemotion", onMotion);

    // iOS gates orientation & motion behind a user gesture
    type ReqPerm = { requestPermission?: () => Promise<"granted" | "denied"> };
    const DOE = (window as unknown as { DeviceOrientationEvent?: ReqPerm }).DeviceOrientationEvent;
    const DME = (window as unknown as { DeviceMotionEvent?: ReqPerm }).DeviceMotionEvent;
    const needPerm = (!!DOE && typeof DOE.requestPermission === "function") || (!!DME && typeof DME.requestPermission === "function");
    const askPerm = () => {
      DOE?.requestPermission?.().catch(() => {});
      DME?.requestPermission?.().catch(() => {});
      window.removeEventListener("touchend", askPerm);
    };
    if (needPerm) window.addEventListener("touchend", askPerm, { once: true });

    const resize = () => {
      const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      bgUniforms.uAspect.value = w / h;
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);

    // ── loop ──
    let raf = 0; let prev = performance.now();
    let idle = 0; let lastTiltMag = 0;
    let lastTiltNote = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      const motion = reduce ? 0 : 1;

      // ease tilt; add a slow idle breathing sway if untouched
      idle += dt;
      const swayX = haveOrient || drag.on ? 0 : Math.sin(idle * 0.6) * 0.12 * motion;
      const swayY = haveOrient || drag.on ? 0 : Math.cos(idle * 0.45) * 0.16 * motion;
      tilt.x += (tilt.tx + swayX - tilt.x) * 0.12;
      tilt.y += (tilt.ty + swayY - tilt.y) * 0.12;

      // flip animation — quaternion slerp toward the target face
      if (flip.t < 1) {
        flip.t = Math.min(1, flip.t + (1 - flip.t) * 0.16 + 0.01);
        flip.base.slerpQuaternions(flip.q0, flip.q1, flip.t);
        if (flip.t >= 1) flip.q0.copy(flip.q1);
      }
      const tossing = flip.t < 1 ? Math.sin(Math.PI * flip.t) : 0;
      coinGroup.position.z = tossing * 3.2;
      // ease the slide-driven size, combined with the flip toss
      size.v += (size.t - size.v) * 0.16;
      coinGroup.scale.setScalar(size.v * (1 + tossing * 0.06));

      // compose: two-finger spin ∘ ambient tilt ∘ flip (all screen-space)
      _tiltEuler.set(tilt.x, tilt.y, 0, "XYZ");
      _qTilt.setFromEuler(_tiltEuler);
      _qSpin.setFromAxisAngle(_z, spin.z);
      coinGroup.quaternion.copy(_qSpin).multiply(_qTilt).multiply(flip.base);

      // shimmer sound on real motion (tilt velocity) — unchanged character
      const tiltMag = Math.abs(tilt.tx) + Math.abs(tilt.ty);
      const tiltVel = Math.abs(tiltMag - lastTiltMag); lastTiltMag = tiltMag;
      if (tiltVel > 0.06) { shine.v = Math.min(1, shine.v + tiltVel * 0.6); shimmer(now, Math.round(tilt.x * 20) + 4, 160); addPoints(0.004); }
      // slow directional tilt → sweep the concordant octave around the coin
      const lean = Math.hypot(tilt.tx, tilt.ty);
      if (lean > 0.4) {
        const sec = sectorOf(tilt.ty, -tilt.tx);
        if (sec !== notes.tiltSec && now - lastTiltNote > 200) { notes.tiltSec = sec; lastTiltNote = now; tiltNote(sec); }
      } else { notes.tiltSec = -1; }

      // drive the aventurine night sky
      fill.v += (fill.t - fill.v) * 0.05;
      fill.spark *= 0.985;
      bgUniforms.uTime.value = now * 0.001 * (reduce ? 0.25 : 1);
      bgUniforms.uFill.value = fill.v;
      bgUniforms.uSpark.value = Math.min(1, fill.spark + fill.v * 0.3);

      // star glint: ride the highlight, fade out
      shine.v *= 0.92;
      const smat = star.material as THREE.SpriteMaterial;
      smat.opacity = Math.min(0.95, shine.v);
      const sc = 8 + shine.v * 8; star.scale.set(sc, sc, 1);
      star.position.set(-2.2 + tilt.y * 3, 2.2 - tilt.x * 3, 6);

      renderer.clear();
      renderer.render(bgScene, bgCam);   // aventurine background
      renderer.clearDepth();
      renderer.render(scene, camera);    // the gold coin over it
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // hide global chrome
    const hideStyle = document.createElement("style");
    hideStyle.textContent = ".oda-tape-shell,.oda-field-watch,.oda-candle-mark,.oda-sound-toggle{display:none !important;}";
    document.head.appendChild(hideStyle);

    (window as unknown as Record<string, unknown>).__coin = { flip: doFlip, ready: true };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try { localStorage.setItem(FILL_KEY, fill.t.toFixed(3)); } catch { /* noop */ }
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("touchend", askPerm);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointercancel", onUp);
      hideStyle.remove();
      renderer.dispose(); pmrem.dispose(); envRT.dispose();
      frontTex.dispose(); backTex.dispose(); reedTex.dispose();
      bgMat.dispose(); bgQuad.geometry.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#000000" }}>
      <div className="coin-hud">
        <div className="coin-title">objet&nbsp;d&rsquo;art — la médaille</div>
        <div className="coin-hint" ref={hintRef}>tap a spot to flip & play its note · tilt or pop to flip · slide to resize · twist with two fingers · rub to shine</div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .coin-hud {
          position: absolute; left: 0; right: 0; z-index: 10; pointer-events: none;
          top: 0; padding: calc(70px + env(safe-area-inset-top,0px)) 20px 0;
          display: grid; gap: 6px; justify-items: center; text-align: center;
        }
        .coin-title {
          font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
          font-weight: 600; font-size: clamp(20px, 4.5vw, 30px);
          background: linear-gradient(180deg,#fff6da,#f6e6b4 30%,#e7b94e 70%,#b8860b 100%);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: #e7b94e;
          text-shadow: 0 2px 16px rgba(0,0,0,0.5);
        }
        .coin-hint {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px; letter-spacing: 0.14em; text-transform: lowercase;
          color: rgba(246,230,180,0.6); transition: opacity .5s ease;
        }
        @media (max-width: 560px){ .coin-hint{ font-size: 10px; } }
      ` }} />
    </div>
  );
}
