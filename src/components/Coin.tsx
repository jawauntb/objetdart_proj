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
// light, RECESSED (engraved) elements dark. face = "front" (cross) | "back".
function makeReliefTexture(face: "front" | "back"): THREE.CanvasTexture {
  const s = 1024;
  const c = document.createElement("canvas"); c.width = c.height = s;
  const x = c.getContext("2d")!;
  const C0 = s / 2;
  // ground
  x.fillStyle = "#8a8a8a"; x.fillRect(0, 0, s, s);
  // raised outer rim ring
  x.lineWidth = 34; x.strokeStyle = "#cfcfcf";
  x.beginPath(); x.arc(C0, C0, s * 0.455, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 6; x.strokeStyle = "#4a4a4a";
  x.beginPath(); x.arc(C0, C0, s * 0.475, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(C0, C0, s * 0.435, 0, Math.PI * 2); x.stroke();
  // beaded inner border
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    x.fillStyle = "#d8d8d8";
    x.beginPath(); x.arc(C0 + Math.cos(a) * s * 0.40, C0 + Math.sin(a) * s * 0.40, 4.5, 0, Math.PI * 2); x.fill();
  }

  if (face === "front") {
    // rim legend (Vade Retro Satana… abbreviated) + PAX at bottom
    x.fillStyle = "#3a3a3a";
    textArc(x, "V R S N S M V", C0, C0, s * 0.372, 200, 340, 42);
    textArc(x, "S M Q L I V B", C0, C0, s * 0.372, 20, 160, 42, true);
    x.font = `700 46px Georgia, serif`; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = "#2e2e2e"; x.fillText("✦ PAX ✦", C0, C0 - s * 0.372);
    // bold raised cross
    const arm = s * 0.30, thick = s * 0.075;
    x.fillStyle = "#dcdcdc";
    x.fillRect(C0 - thick / 2, C0 - arm, thick, arm * 2);
    x.fillRect(C0 - arm, C0 - thick / 2, arm * 2, thick);
    x.strokeStyle = "#3a3a3a"; x.lineWidth = 5;
    x.strokeRect(C0 - thick / 2, C0 - arm, thick, arm * 2);
    x.strokeRect(C0 - arm, C0 - thick / 2, arm * 2, thick);
    // letters on the cross: vertical C S S M L, horizontal N D S M D
    x.fillStyle = "#2b2b2b"; x.font = `700 40px Georgia, serif`;
    const vs = ["C", "S", "S", "M", "L"]; // top→bottom
    vs.forEach((ch, i) => x.fillText(ch, C0, C0 - arm + 44 + (i * (arm * 2 - 80)) / 4));
    const hs = ["N", "D", "S", "M", "D"];
    hs.forEach((ch, i) => { if (i !== 2) x.fillText(ch, C0 - arm + 44 + (i * (arm * 2 - 80)) / 4, C0); });
    // quadrant letters C S P B (Crux Sancti Patris Benedicti)
    x.font = `700 52px Georgia, serif`;
    const q = s * 0.20;
    x.fillText("C", C0 - q, C0 - q); x.fillText("S", C0 + q, C0 - q);
    x.fillText("S", C0 - q, C0 + q); x.fillText("B", C0 + q, C0 + q);
  } else {
    // reverse: rim legend + a standing figure with cross & book + rays
    x.fillStyle = "#3a3a3a";
    textArc(x, "EIVS IN OBITV", C0, C0, s * 0.372, 200, 340, 40);
    textArc(x, "NOSTRO PRAESENTIA", C0, C0, s * 0.372, 12, 168, 34, true);
    x.font = `700 40px Georgia, serif`; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = "#2e2e2e"; x.fillText("✦ MVNIAMVR ✦", C0, C0 - s * 0.372);
    // radiating rays behind the figure
    x.strokeStyle = "#bcbcbc"; x.lineWidth = 4;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      x.beginPath(); x.moveTo(C0 + Math.cos(a) * 70, C0 + Math.sin(a) * 70);
      x.lineTo(C0 + Math.cos(a) * s * 0.33, C0 + Math.sin(a) * s * 0.33); x.stroke();
    }
    // standing robed figure (stylised)
    x.fillStyle = "#d6d6d6"; x.strokeStyle = "#333"; x.lineWidth = 5;
    // robe
    x.beginPath();
    x.moveTo(C0 - 70, C0 + 190); x.lineTo(C0 - 40, C0 - 70);
    x.quadraticCurveTo(C0, C0 - 120, C0 + 40, C0 - 70);
    x.lineTo(C0 + 70, C0 + 190); x.closePath(); x.fill(); x.stroke();
    // head + halo
    x.beginPath(); x.arc(C0, C0 - 110, 34, 0, Math.PI * 2); x.fill(); x.stroke();
    x.lineWidth = 4; x.beginPath(); x.arc(C0, C0 - 110, 48, 0, Math.PI * 2); x.stroke();
    // tall cross (left hand) + book (right hand)
    x.lineWidth = 12; x.strokeStyle = "#cfcfcf";
    x.beginPath(); x.moveTo(C0 - 120, C0 - 150); x.lineTo(C0 - 120, C0 + 150); x.stroke();
    x.beginPath(); x.moveTo(C0 - 150, C0 - 90); x.lineTo(C0 - 90, C0 - 90); x.stroke();
    x.fillStyle = "#cfcfcf"; x.strokeStyle = "#333"; x.lineWidth = 4;
    x.fillRect(C0 + 78, C0 - 10, 70, 90); x.strokeRect(C0 + 78, C0 - 10, 70, 90);
    x.beginPath(); x.moveTo(C0 + 113, C0 - 10); x.lineTo(C0 + 113, C0 + 80); x.stroke();
    // ground line
    x.lineWidth = 6; x.strokeStyle = "#555";
    x.beginPath(); x.moveTo(C0 - 130, C0 + 200); x.lineTo(C0 + 130, C0 + 200); x.stroke();
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
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:grab";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0806);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.02);
    scene.environment = envRT.texture;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 23);

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
    const matFront = new THREE.MeshStandardMaterial({ ...gold, roughness: 0.26, bumpMap: frontTex, bumpScale: 6 });
    const matBack = new THREE.MeshStandardMaterial({ ...gold, roughness: 0.26, bumpMap: backTex, bumpScale: 6 });
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
    const flip = { cur: 0, target: 0 };            // accumulating flip spin (radians)
    const shine = { v: 0 };                        // star glint strength
    const drag = { on: false, px: 0, py: 0, moved: 0, downT: 0, lastRub: 0 };

    // ── audio ──
    const A = () => getFieldAudio();
    const ting = () => { try { const a = A(); a.playNote(88, 55); window.setTimeout(() => a.playNote(95, 40), 45); a.bell(); } catch { /* noop */ } };
    const flipSound = () => { try { const a = A(); a.playNote(79, 60); window.setTimeout(() => a.playNote(86, 50), 90); } catch { /* noop */ } };
    let lastShimmer = 0;
    const shimmer = (now: number, pitch: number, gap = 150) => {
      if (now - lastShimmer < gap) return; lastShimmer = now;
      try { A().playNote(90 + (pitch % 8), 30); } catch { /* noop */ }
    };

    const doFlip = () => {
      flip.target += Math.PI * (Math.random() < 0.5 ? 5 : 7); // odd → lands other face
      shine.v = 1; flipSound(); haptics.roll();
      useField.getState().recordTape("sigil", 0.9, "coin/flip");
      if (hintRef.current) hintRef.current.style.opacity = "0";
    };

    // ── pointer (drag to rotate, tap to flip, rub for shine) ──
    const onDown = (e: PointerEvent) => {
      drag.on = true; drag.px = e.clientX; drag.py = e.clientY; drag.moved = 0; drag.downT = performance.now();
      renderer.domElement.setPointerCapture?.(e.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!drag.on) return;
      const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
      drag.px = e.clientX; drag.py = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      tilt.ty += dx * 0.006;   // yaw
      tilt.tx += dy * 0.006;   // pitch
      tilt.tx = Math.max(-1.1, Math.min(1.1, tilt.tx));
      const now = performance.now();
      const speed = Math.abs(dx) + Math.abs(dy);
      if (speed > 3) { shine.v = Math.min(1, shine.v + speed * 0.02); shimmer(now, Math.round(e.clientX / 40), 90); if (now - drag.lastRub > 120) { haptics.tap(); drag.lastRub = now; } }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag.on) return; drag.on = false;
      renderer.domElement.style.cursor = "grab";
      const dt = performance.now() - drag.downT;
      if (drag.moved < 8 && dt < 400) { ting(); shine.v = 1; haptics.tap(); useField.getState().recordTape("object", 0.6, "coin/tap"); doFlip(); }
      renderer.domElement.releasePointerCapture?.(e.pointerId);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointercancel", onUp);

    // ── device gyroscope (tilt the phone) ──
    let haveOrient = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      haveOrient = true;
      const gx = (e.gamma ?? 0) / 40;           // left/right
      const gy = ((e.beta ?? 0) - 35) / 40;     // front/back
      tilt.ty = Math.max(-1.2, Math.min(1.2, gx));
      tilt.tx = Math.max(-1.2, Math.min(1.2, gy));
    };
    window.addEventListener("deviceorientation", onOrient);
    // iOS gates orientation behind a gesture
    type DOEP = { requestPermission?: () => Promise<"granted" | "denied"> };
    const DOE = (window as unknown as { DeviceOrientationEvent?: DOEP }).DeviceOrientationEvent;
    const needPerm = !!DOE && typeof DOE.requestPermission === "function";
    const askOrient = () => { if (needPerm && DOE?.requestPermission) DOE.requestPermission().catch(() => {}); window.removeEventListener("touchend", askOrient); };
    if (needPerm) window.addEventListener("touchend", askOrient, { once: true });

    const resize = () => {
      const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);

    // ── loop ──
    let raf = 0; let prev = performance.now();
    let idle = 0; let lastTiltMag = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      const motion = reduce ? 0 : 1;

      // ease tilt; add a slow idle breathing sway if untouched
      idle += dt;
      const swayX = haveOrient || drag.on ? 0 : Math.sin(idle * 0.6) * 0.12 * motion;
      const swayY = haveOrient || drag.on ? 0 : Math.cos(idle * 0.45) * 0.16 * motion;
      tilt.x += (tilt.tx + swayX - tilt.x) * 0.12;
      tilt.y += (tilt.ty + swayY - tilt.y) * 0.12;

      // flip spring (with a little toss toward the camera)
      const remain = flip.target - flip.cur;
      flip.cur += remain * 0.14;
      const tossing = Math.min(1, Math.abs(remain) / 3);
      coinGroup.position.z = tossing * 3.2;
      coinGroup.scale.setScalar(1 + tossing * 0.06);

      coinGroup.rotation.x = tilt.x + flip.cur;
      coinGroup.rotation.y = tilt.y;

      // shimmer sound on real motion (tilt velocity)
      const tiltMag = Math.abs(tilt.tx) + Math.abs(tilt.ty) + Math.abs(flip.cur);
      const tiltVel = Math.abs(tiltMag - lastTiltMag); lastTiltMag = tiltMag;
      if (tiltVel > 0.06) { shine.v = Math.min(1, shine.v + tiltVel * 0.6); shimmer(now, Math.round(tilt.x * 20) + 4, 160); }

      // star glint: ride the highlight, fade out
      shine.v *= 0.92;
      const smat = star.material as THREE.SpriteMaterial;
      smat.opacity = Math.min(0.95, shine.v);
      const sc = 8 + shine.v * 8; star.scale.set(sc, sc, 1);
      star.position.set(-2.2 + tilt.y * 3, 2.2 - tilt.x * 3, 6);

      renderer.render(scene, camera);
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
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("touchend", askOrient);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointercancel", onUp);
      hideStyle.remove();
      renderer.dispose(); pmrem.dispose(); envRT.dispose();
      frontTex.dispose(); backTex.dispose(); reedTex.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#0a0806" }}>
      <div className="coin-hud">
        <div className="coin-title">objet&nbsp;d&rsquo;art — la médaille</div>
        <div className="coin-hint" ref={hintRef}>tilt your phone · drag to turn · tap to flip · rub for shine</div>
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
