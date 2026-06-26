"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * /movement — a real(ish) mechanical watch movement in Three.js.
 *
 * A skeletonised going train laid face-up: mainspring barrel → centre wheel →
 * third wheel → fourth wheel → escape wheel, regulated by a Swiss lever
 * escapement and an oscillating balance. The wheels are compound (wheel +
 * pinion) so the ratios are real: the centre arbor turns once an hour, the
 * fourth once a minute, and the hands tell the actual local time. Everything
 * is polished metal under a studio environment so it reads like a movement,
 * not a diagram. Orbit to inspect; ?view= and ?spin= drive the camera.
 */

// ── tunable configuration (refined through the screenshot loop) ──────────
const CFG = {
  module: 0.16,          // gear tooth module (size of teeth)
  plateR: 13,
  plateThick: 0.7,
  wheelThick: 0.34,
  pinionThick: 0.5,
  exposure: 1.12,
  bg: 0x0a0b0e,
  // stations: compound gears. teeth = big wheel, pinion = small driving gear.
  // pos filled in below by the meshing solver.
};

type Vec2 = { x: number; y: number };

function add(a: Vec2, d: number, ang: number): Vec2 {
  return { x: a.x + d * Math.cos(ang), y: a.y + d * Math.sin(ang) };
}

// Build a toothed gear profile as an extruded shape with optional spokes.
function gearGeometry(opts: {
  teeth: number; module: number; thick: number;
  bore?: number; spokes?: number; rimRatio?: number; hub?: number; bevel?: number;
}): THREE.ExtrudeGeometry {
  const { teeth, module: m, thick } = opts;
  const bevel = opts.bevel ?? 0.04;
  const pitch = (m * teeth) / 2;
  const Ra = pitch + m * 1.0;   // addendum (tip)
  const Rr = pitch - m * 1.25;  // dedendum (root)
  const step = (Math.PI * 2) / teeth;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    // trapezoidal tooth with a flat valley; bevel rounds the edges later
    const pts: Array<[number, number]> = [
      [Rr, 0.00], [Rr, 0.30], [Ra, 0.40], [Ra, 0.60], [Rr, 0.70], [Rr, 1.0],
    ];
    pts.forEach(([r, f], k) => {
      const a = a0 + f * step;
      const x = r * Math.cos(a), y = r * Math.sin(a);
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();

  // crossings / spokes: cut lightening holes between hub and rim
  const spokes = opts.spokes ?? 0;
  if (spokes > 0) {
    const rimInner = Rr - m * 1.6;
    const hub = opts.hub ?? pitch * 0.20;
    const holeR = (rimInner - hub) * 0.5 * 0.82;
    const ringR = (rimInner + hub) * 0.5;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + step / 2;
      const hx = ringR * Math.cos(a), hy = ringR * Math.sin(a);
      const hole = new THREE.Path();
      hole.absarc(hx, hy, holeR, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  // central bore
  const bore = opts.bore ?? pitch * 0.08;
  const boreHole = new THREE.Path();
  boreHole.absarc(0, 0, bore, 0, Math.PI * 2, true);
  shape.holes.push(boreHole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, steps: 1, curveSegments: Math.max(24, teeth * 2),
  });
  geo.center();
  geo.rotateX(-Math.PI / 2); // lay flat: extrude along +Y
  return geo;
}

const SPEEDS = [
  { label: "real time", v: 1 },
  { label: "30×", v: 30 },
  { label: "300×", v: 300 },
];
const VIEWS = ["iso", "top", "side", "macro-balance", "macro-escape", "macro-train"];

export default function Movement() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef(1);
  const applyViewRef = useRef<((n: string) => void) | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState("iso");

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const params = new URLSearchParams(window.location.search);
    const spin = params.get("spin") !== "0";
    const view0 = params.get("view") || "iso";
    const shotMode = params.get("shot") === "1"; // cheap render for headless capture

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(shotMode ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = CFG.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = !shotMode;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CFG.bg);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.position.set(0, 26, 20);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 8;
    controls.maxDistance = 70;
    controls.target.set(0, 0, 0);
    controls.autoRotate = spin;
    controls.autoRotateSpeed = 0.7;

    // ── lighting ──
    const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
    key.position.set(10, 22, 12);
    key.castShadow = !shotMode;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 80;
    key.shadow.camera.left = -20; key.shadow.camera.right = 20;
    key.shadow.camera.top = 20; key.shadow.camera.bottom = -20;
    key.shadow.bias = -0.0004;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.1);
    rim.position.set(-14, 8, -10);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // Côtes de Genève — sweeping circular stripes that make the plate shimmer.
    const genevaTex = (() => {
      const s = 1024;
      const c = document.createElement("canvas"); c.width = c.height = s;
      const x = c.getContext("2d")!;
      x.fillStyle = "#8f9298"; x.fillRect(0, 0, s, s);
      const cx = s * 1.35, cy = s * 0.5;
      for (let r = 40; r < 2400; r += 24) {
        const band = Math.floor(r / 24) % 2;
        const g = band ? 150 : 132;
        x.strokeStyle = `rgb(${g},${g + 3},${g + 8})`;
        x.lineWidth = 13; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
      }
      // faint perlage speckle for the rest
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    })();
    const genevaRough = genevaTex.clone(); genevaRough.colorSpace = THREE.NoColorSpace;

    // ── materials ──
    const matPlate = new THREE.MeshStandardMaterial({ color: 0xc3c6cc, metalness: 1, roughness: 0.55, map: genevaTex, roughnessMap: genevaRough });
    const matBrass = new THREE.MeshStandardMaterial({ color: 0xd8a85a, metalness: 1, roughness: 0.22 });
    const matSteel = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 1, roughness: 0.16 });
    const matBlued = new THREE.MeshStandardMaterial({ color: 0x2b3d6b, metalness: 1, roughness: 0.18 });
    const matBalance = new THREE.MeshStandardMaterial({ color: 0xe9c873, metalness: 1, roughness: 0.2 });
    const matRuby = new THREE.MeshPhysicalMaterial({ color: 0x8e1326, metalness: 0, roughness: 0.08, transmission: 0.5, ior: 1.76, thickness: 0.4 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x111317, metalness: 0.6, roughness: 0.4 });
    const matGold = new THREE.MeshStandardMaterial({ color: 0xf2d089, metalness: 1, roughness: 0.18 });

    const root = new THREE.Group();
    scene.add(root);

    // base / main plate
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(CFG.plateR, CFG.plateR, CFG.plateThick, 96),
      matPlate,
    );
    plate.position.y = -1.2;
    plate.receiveShadow = true;
    root.add(plate);
    // chamfered rim ring
    const rimRing = new THREE.Mesh(
      new THREE.TorusGeometry(CFG.plateR, 0.35, 16, 96),
      new THREE.MeshStandardMaterial({ color: 0xcfd3d9, metalness: 1, roughness: 0.3 }),
    );
    rimRing.rotation.x = Math.PI / 2;
    rimRing.position.y = -1.2 + CFG.plateThick / 2;
    root.add(rimRing);

    // helper to add a jewel in a chaton
    const addJewel = (x: number, z: number, y: number, r = 0.42) => {
      const j = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.22, 20), matRuby);
      j.position.set(x, y, z);
      root.add(j);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.12, 0.09, 10, 24), matGold);
      ring.rotation.x = Math.PI / 2; ring.position.set(x, y, z);
      root.add(ring);
    };

    // a spinning compound wheel: big wheel + pinion + arbor, grouped.
    type Station = {
      group: THREE.Group; omega: number; pos: Vec2; pitchWheel: number; pinionR: number;
    };
    const m = CFG.module;
    const planeY = 0; // wheels sit around here, stacked slightly in Y

    const makeStation = (o: {
      pos: Vec2; wheelTeeth: number; pinionTeeth: number; omega: number;
      y?: number; spokes?: number; wheelMat?: THREE.Material; tall?: boolean;
    }): Station => {
      const g = new THREE.Group();
      g.position.set(o.pos.x, o.y ?? planeY, o.pos.y);
      const wheel = new THREE.Mesh(
        gearGeometry({ teeth: o.wheelTeeth, module: m, thick: CFG.wheelThick, spokes: o.spokes ?? 5 }),
        o.wheelMat ?? matBrass,
      );
      wheel.castShadow = true; wheel.receiveShadow = true;
      g.add(wheel);
      // pinion sits below the wheel (toward plate)
      const pinion = new THREE.Mesh(
        gearGeometry({ teeth: o.pinionTeeth, module: m, thick: CFG.pinionThick, spokes: 0, bevel: 0.02 }),
        matSteel,
      );
      pinion.position.y = -0.42;
      pinion.castShadow = true;
      g.add(pinion);
      // arbor
      const arbor = new THREE.Mesh(new THREE.CylinderGeometry(m * 1.0, m * 1.0, 2.2, 16), matSteel);
      arbor.position.y = -0.6;
      g.add(arbor);
      root.add(g);
      return { group: g, omega: o.omega, pos: o.pos, pitchWheel: (m * o.wheelTeeth) / 2, pinionR: (m * o.pinionTeeth) / 2 };
    };

    // ── going-train geometry (compound ratios → real time) ──
    // base angular rate: centre wheel = 1 rev / 3600 s
    const wc = (Math.PI * 2) / 3600;
    // teeth chosen so centre→fourth = 60×  (Wc*Wt)/(Pt*Pf) = (80*75)/(10*10)=60
    const Wc = 80, Pt = 10, Wt = 75, Pf = 10, Wf = 70, Pe = 7, Pc = 12, Wbar = 96;

    const centerPos: Vec2 = { x: 0, y: 0 };
    const thirdPos = add(centerPos, m * (Wc + Pt) / 2, -0.55);
    const fourthPos = add(thirdPos, m * (Wt + Pf) / 2, -1.7);
    const escapePos = add(fourthPos, m * (Wf + Pe) / 2, -2.9);
    const barrelPos = add(centerPos, m * (Wbar + Pc) / 2, 2.5);

    // centre wheel (carries minute hand). spins clockwise-from-top = -wc about Y
    const center = makeStation({ pos: centerPos, wheelTeeth: Wc, pinionTeeth: Pc, omega: -wc, spokes: 5 });
    const third = makeStation({ pos: thirdPos, wheelTeeth: Wt, pinionTeeth: Pt, omega: wc * (Wc / Pt), spokes: 4 });
    const fourth = makeStation({ pos: fourthPos, wheelTeeth: Wf, pinionTeeth: Pf, omega: -wc * (Wc * Wt) / (Pt * Pf), spokes: 4 });
    const escape = makeStation({ pos: escapePos, wheelTeeth: 15, pinionTeeth: Pe, omega: wc * (Wc * Wt * Wf) / (Pt * Pf * Pe), spokes: 0, wheelMat: matSteel });
    const barrel = makeStation({ pos: barrelPos, wheelTeeth: Wbar, pinionTeeth: 12, omega: -wc * (Pc / Wbar), spokes: 6, wheelMat: matGold });

    // mainspring barrel: a drum narrower than the wheel so the teeth ring
    // shows, capped by a ratchet wheel + blued click and three screws.
    const barrelPitch = (m * Wbar) / 2;
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(barrelPitch * 0.6, barrelPitch * 0.6, 0.9, 64),
      new THREE.MeshStandardMaterial({ color: 0xc9a14e, metalness: 1, roughness: 0.32 }),
    );
    drum.position.set(barrelPos.x, 0.55, barrelPos.y);
    drum.castShadow = true;
    root.add(drum);
    // ratchet wheel on top
    const ratchet = new THREE.Mesh(
      gearGeometry({ teeth: 30, module: m * 0.9, thick: 0.3, spokes: 0, bevel: 0.03 }),
      matGold,
    );
    ratchet.position.set(barrelPos.x, 1.15, barrelPos.y);
    ratchet.castShadow = true;
    root.add(ratchet);
    // three blued screws on the drum cap
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 16), matBlued);
      screw.position.set(barrelPos.x + Math.cos(a) * barrelPitch * 0.32, 1.05, barrelPos.y + Math.sin(a) * barrelPitch * 0.32);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.08), matSteel);
      slot.position.copy(screw.position); slot.position.y += 0.1; slot.rotation.y = a;
      root.add(screw); root.add(slot);
    }

    const stations = [center, third, fourth, escape, barrel];
    [centerPos, thirdPos, fourthPos, escapePos, barrelPos].forEach((p) => addJewel(p.x, p.y, 1.0, 0.34));

    // ── escapement: pallet fork + balance ──
    const escR = (15 * m) / 2;
    const balancePos = add(escapePos, escR + 4.2, -0.2);

    // pallet fork (blued steel), pivoting between escape and balance
    const fork = new THREE.Group();
    const forkPos = add(escapePos, escR + 1.4, 0.4);
    fork.position.set(forkPos.x, 0.4, forkPos.y);
    const forkBar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.5), matBlued);
    fork.add(forkBar);
    const forkStem = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 2.0), matBlued);
    forkStem.position.z = 1.0; fork.add(forkStem);
    [-1.2, 1.2].forEach((x) => {
      const pallet = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.5), matRuby);
      pallet.position.set(x, 0, 0); fork.add(pallet);
    });
    fork.castShadow = true;
    root.add(fork);

    // balance wheel: rim + crossing + hairspring
    const balance = new THREE.Group();
    balance.position.set(balancePos.x, 1.0, balancePos.y);
    const balR = 3.4;
    const balRim = new THREE.Mesh(new THREE.TorusGeometry(balR, 0.22, 16, 64), matBalance);
    balRim.rotation.x = Math.PI / 2; balRim.castShadow = true; balance.add(balRim);
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(balR * 2, 0.14, 0.34), matBalance);
      arm.rotation.y = (i / 3) * Math.PI; balance.add(arm);
    }
    // timing screws around the rim
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 10), matSteel);
      screw.rotation.z = Math.PI / 2;
      screw.position.set(Math.cos(a) * balR, 0, Math.sin(a) * balR);
      screw.lookAt(balance.position);
      balance.add(screw);
    }
    // hairspring: a flat spiral of tube segments
    const spiralPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 240; i++) {
      const tt = i / 240; const a = tt * Math.PI * 2 * 5; const r = 0.4 + tt * 1.7;
      spiralPts.push(new THREE.Vector3(Math.cos(a) * r, -0.5, Math.sin(a) * r));
    }
    const hair = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spiralPts), 240, 0.03, 6, false), matBlued);
    balance.add(hair);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 12), matSteel);
    balance.add(staff);
    root.add(balance);
    addJewel(balancePos.x, balancePos.y, 1.9, 0.4);

    // balance cock — a slim polished bridge arching over the balance, anchored
    // toward the escape side, carrying the upper balance jewel.
    {
      const anchor = add(balancePos, balR + 1.2, Math.atan2(escapePos.y - balancePos.y, escapePos.x - balancePos.x));
      const cock = new THREE.Group();
      const dx = balancePos.x - anchor.x, dz = balancePos.y - anchor.y;
      const len = Math.hypot(dx, dz);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.34, 1.1), matPlate);
      arm.position.set(anchor.x + dx / 2, 2.35, anchor.y + dz / 2);
      arm.rotation.y = -Math.atan2(dz, dx);
      arm.castShadow = true;
      cock.add(arm);
      // foot + two screws at the anchored end
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.4, 20), matPlate);
      foot.position.set(anchor.x, 2.25, anchor.y); cock.add(foot);
      [-0.5, 0.5].forEach((o) => {
        const sx = anchor.x + Math.cos(arm.rotation.y + Math.PI / 2) * o;
        const sz = anchor.y - Math.sin(arm.rotation.y + Math.PI / 2) * o;
        const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 14), matBlued);
        screw.position.set(sx, 2.4, sz); cock.add(screw);
      });
      // end boss + upper jewel over the balance staff
      const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.42, 20), matPlate);
      boss.position.set(balancePos.x, 2.4, balancePos.y); cock.add(boss);
      const upperJewel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 16), matRuby);
      upperJewel.position.set(balancePos.x, 2.62, balancePos.y); cock.add(upperJewel);
      root.add(cock);
    }

    // ── motion works + hands at centre ──
    const hands = new THREE.Group();
    hands.position.set(centerPos.x, 1.6, centerPos.y);
    root.add(hands);
    const mkHand = (len: number, w: number, h: number, mat: THREE.Material, tailMul = 0.22) => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
      shaft.position.z = len / 2 - len * tailMul; shaft.castShadow = true; g.add(shaft);
      return g;
    };
    const hourHand = mkHand(4.6, 0.5, 0.18, matBlued);
    const minuteHand = mkHand(6.6, 0.36, 0.16, matBlued);
    hands.add(hourHand); hands.add(minuteHand);
    const capH = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 18), matGold);
    hands.add(capH);
    // small seconds on the fourth-wheel arbor
    const secHand = mkHand(2.2, 0.16, 0.12, matBlued, 0.28);
    const secGroup = new THREE.Group();
    secGroup.position.set(fourthPos.x, 1.5, fourthPos.y);
    secGroup.add(secHand);
    const secCap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 12), matGold);
    secGroup.add(secCap);
    root.add(secGroup);

    // ── camera presets (framed from the assembly's bounding sphere) ──
    const box = new THREE.Box3().setFromObject(root);
    const ctr = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const R = sphere.radius;
    const applyView = (name: string) => {
      controls.autoRotate = false;
      const set = (dir: THREE.Vector3, dist: number, t: THREE.Vector3) => {
        camera.position.copy(t).add(dir.clone().normalize().multiplyScalar(dist));
        controls.target.copy(t); controls.update();
      };
      const C0 = ctr.clone();
      const bal = new THREE.Vector3(balancePos.x, 1, balancePos.y);
      const esc = new THREE.Vector3(escapePos.x, 0.6, escapePos.y);
      const trn = new THREE.Vector3(thirdPos.x, 0, thirdPos.y);
      switch (name) {
        case "top": set(new THREE.Vector3(0, 1, 0.0001), R * 2.5, C0); break;
        case "iso": set(new THREE.Vector3(0.7, 1.0, 0.95), R * 2.3, C0); break;
        case "side": set(new THREE.Vector3(0, 0.18, 1), R * 2.6, C0); break;
        case "macro-balance": set(new THREE.Vector3(0.6, 0.9, 1), R * 0.9, bal); break;
        case "macro-escape": set(new THREE.Vector3(0.7, 0.8, 1), R * 0.7, esc); break;
        case "macro-train": set(new THREE.Vector3(0.4, 1.1, 1), R * 1.2, trn); break;
        default: set(new THREE.Vector3(0.7, 1.0, 0.95), R * 2.3, C0);
      }
    };
    applyView(view0);
    applyViewRef.current = applyView;
    controls.autoRotate = spin;

    // hide the global site chrome while inspecting the movement
    const hideStyle = document.createElement("style");
    hideStyle.textContent = ".oda-tape-shell,.oda-field-watch,.oda-candle-mark,.oda-sound-toggle{display:none !important;}";
    document.head.appendChild(hideStyle);

    // expose hooks for the screenshot harness
    (window as unknown as Record<string, unknown>).__movement = {
      setView: (n: string) => { applyView(n); renderer.render(scene, camera); },
      ready: true,
    };

    // ── resize ──
    const resize = () => {
      const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── animation ──────────────────────────────────────────────────
    // The escapement releases one escape-wheel tooth per balance cycle, so
    // the fast wheels (escape/fourth/third) and the seconds hand advance in
    // quantised steps — the signature "tick" of a mechanical watch — while
    // the balance itself swings smoothly. At real-time rate this still tells
    // the actual local time; the speed control fast-forwards the whole train.
    const startLocalSec = (() => {
      const d = new Date();
      return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    })();
    const epoch = Date.now();
    const TICK = 0.4;          // seconds per escape tooth (15 teeth → 6 s/rev)
    const balHz = 1 / TICK;    // one balance cycle per tooth = 2.5 Hz
    let raf = 0;

    const tick = () => {
      const sp = speedRef.current;
      // simulated seconds-of-day: exact local time at 1×, fast-forwarded above
      const simSec = sp === 1
        ? (() => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000; })()
        : startLocalSec + ((Date.now() - epoch) / 1000) * sp;

      const step = TICK; // tooth cadence in sim-seconds (constant; sp scales simSec)
      const tEff = Math.floor(simSec / step) * step; // quantised time for fast wheels

      // fast wheels step; slow wheels (centre, barrel) run smooth
      stations.forEach((s) => {
        const smooth = s === center || s === barrel;
        s.group.rotation.y = s.omega * (smooth ? simSec : tEff);
      });
      drum.rotation.y = barrel.omega * simSec;
      ratchet.rotation.y = barrel.omega * simSec;

      // balance: smooth SHM; pallet fork snaps with the tick
      const ph = simSec * balHz; // cycles
      balance.rotation.y = Math.sin(ph * Math.PI * 2) * 1.05;
      fork.rotation.y = (Math.floor(ph * 2) % 2 ? 1 : -1) * 0.17;

      // hands: hour/minute smooth, seconds steps with the escapement
      hourHand.rotation.y = -((simSec / 3600) % 12) / 12 * Math.PI * 2;
      minuteHand.rotation.y = -((simSec / 60) % 60) / 60 * Math.PI * 2;
      secGroup.rotation.y = -((tEff % 60) / 60) * Math.PI * 2;

      if (clockRef.current) {
        const s = Math.floor(simSec) % 86400;
        const hh = String(Math.floor(s / 3600) % 24).padStart(2, "0");
        const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        clockRef.current.textContent = `${hh}:${mm}:${ss}`;
      }

      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      pmrem.dispose();
      hideStyle.remove();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#0a0b0e" }}>
      <div className="mv-hud">
        <div className="mv-title">
          objet&nbsp;d&apos;art — calibre OD·1 <span className="mv-clock" ref={clockRef}>--:--:--</span>
        </div>
        <div className="mv-row" role="group" aria-label="speed">
          {SPEEDS.map((s) => (
            <button key={s.v} type="button" className={speed === s.v ? "on" : ""}
              onClick={() => { speedRef.current = s.v; setSpeed(s.v); }}>{s.label}</button>
          ))}
        </div>
        <div className="mv-row" role="group" aria-label="view">
          {VIEWS.map((v) => (
            <button key={v} type="button" className={view === v ? "on" : ""}
              onClick={() => { applyViewRef.current?.(v); setView(v); }}>{v.replace("macro-", "")}</button>
          ))}
        </div>
        <div className="mv-hint">drag to orbit · scroll / pinch to zoom · hands tell real local time</div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .mv-hud {
          position: absolute; left: 0; top: 0; padding: 16px;
          display: grid; gap: 8px; justify-items: start;
          pointer-events: none; z-index: 10;
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        .mv-title {
          font-family: var(--font-fraunces, Georgia, serif);
          font-size: 15px; letter-spacing: 0.4px;
          color: rgba(242,238,230,0.92);
          text-shadow: 0 1px 8px rgba(0,0,0,0.6);
        }
        .mv-clock { color: #e7c873; margin-left: 8px; font-variant-numeric: tabular-nums; }
        .mv-row { display: flex; gap: 6px; flex-wrap: wrap; pointer-events: auto; }
        .mv-row button {
          appearance: none; cursor: pointer;
          border: 1px solid rgba(231,211,154,0.3);
          background: rgba(12,13,16,0.55); backdrop-filter: blur(6px);
          color: rgba(242,238,230,0.82);
          font-size: 11px; letter-spacing: 0.3px; text-transform: lowercase;
          padding: 7px 11px; border-radius: 7px;
          transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
        }
        .mv-row button:hover { border-color: rgba(231,211,154,0.6); color: #f4ecd6; }
        .mv-row button.on { background: rgba(231,211,154,0.18); border-color: rgba(231,211,154,0.8); color: #f6e6b4; }
        .mv-hint {
          font-size: 10px; letter-spacing: 0.3px; text-transform: lowercase;
          color: rgba(242,238,230,0.4); text-shadow: 0 1px 6px rgba(0,0,0,0.6);
        }
        @media (max-width: 560px) { .mv-title { font-size: 13px; } .mv-row button { padding: 8px 10px; } }
      ` }} />
    </div>
  );
}
