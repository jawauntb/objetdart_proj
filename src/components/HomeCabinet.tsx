"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import RouteSigil from "@/components/RouteSigil";
import ConcernSigil from "@/components/ConcernSigil";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { SITE_ROUTE_BY_KEY, SITE_ROUTES, type SiteRouteCluster, type SiteRouteEntry } from "@/lib/routes";
import { useField } from "@/store/field";
import type { ConcernKey } from "@/lib/types";

type HomeCabinetPatina = {
  glow: number;
  visits: number;
  routes: Record<string, number>;
  cluster: SiteRouteCluster;
};

const STORAGE_KEY = "objetdart:home-cabinet:v1";

const CLUSTERS: Array<{
  id: SiteRouteCluster;
  label: string;
  desc: string;
  color: string;
  glow: string;
  pitch: number;
}> = [
  { id: "field", label: "field", desc: "tune · cross · read", color: "#f3d37a", glow: "rgba(231,185,78,0.42)", pitch: 55 },
  { id: "water", label: "water", desc: "waves · text · weather", color: "#69d8d0", glow: "rgba(105,216,208,0.36)", pitch: 62 },
  { id: "nature", label: "nature", desc: "fire · earth · stars", color: "#a9d879", glow: "rgba(169,216,121,0.34)", pitch: 67 },
  { id: "mechanism", label: "mechanism", desc: "coin · watch · signal", color: "#d7b4ff", glow: "rgba(215,180,255,0.34)", pitch: 72 },
];

const CLUSTER_BY_ID = Object.fromEntries(CLUSTERS.map((cluster) => [cluster.id, cluster])) as Record<SiteRouteCluster, typeof CLUSTERS[number]>;
const CLUSTER_INDEX_BY_ID = Object.fromEntries(CLUSTERS.map((cluster, index) => [cluster.id, index])) as Record<SiteRouteCluster, number>;

const LOCAL_ENTRIES: Array<{ key: string; label: string; anchor: string; desc: string; icon: SiteRouteEntry["icon"] }> = [
  { key: "field", label: "field", anchor: "concern-field", desc: "the concern compass", icon: "atlas" },
  { key: "chart", label: "chart", anchor: "live-chart", desc: "the departure swell", icon: "charts" },
  { key: "atlas", label: "atlas", anchor: "atlas", desc: "the territories", icon: "atlas" },
  { key: "reading", label: "reading", anchor: "reading", desc: "the room speaks back", icon: "kept" },
];

const LOCAL_ENTRY_BY_KEY = Object.fromEntries(LOCAL_ENTRIES.map((entry) => [entry.key, entry])) as Record<string, typeof LOCAL_ENTRIES[number]>;
const ROUTES_BY_CLUSTER = Object.fromEntries(
  CLUSTERS.map((cluster) => [cluster.id, SITE_ROUTES.filter((route) => route.cluster === cluster.id)]),
) as Record<SiteRouteCluster, SiteRouteEntry[]>;
const SORTED_ROUTES_BY_CLUSTER = Object.fromEntries(
  CLUSTERS.map((cluster) => [
    cluster.id,
    ROUTES_BY_CLUSTER[cluster.id]
      .slice()
      .sort((a, b) => (b.homePriority ?? 0) - (a.homePriority ?? 0) || a.key.localeCompare(b.key)),
  ]),
) as Record<SiteRouteCluster, SiteRouteEntry[]>;

function blankPatina(): HomeCabinetPatina {
  return { glow: 0, visits: 0, routes: {}, cluster: "field" };
}

function safePatina(raw: string | null): HomeCabinetPatina {
  if (!raw) return blankPatina();
  try {
    const parsed = JSON.parse(raw) as Partial<HomeCabinetPatina>;
    const cluster = parsed.cluster && CLUSTER_BY_ID[parsed.cluster] ? parsed.cluster : "field";
    return {
      glow: Math.max(0, Number(parsed.glow) || 0),
      visits: Math.max(0, Number(parsed.visits) || 0),
      routes: parsed.routes && typeof parsed.routes === "object" ? parsed.routes : {},
      cluster,
    };
  } catch {
    return blankPatina();
  }
}

function clusterRoutes(cluster: SiteRouteCluster): SiteRouteEntry[] {
  return SORTED_ROUTES_BY_CLUSTER[cluster];
}

function routeAngle(route: SiteRouteEntry, index: number): number {
  const clusterIndex = CLUSTER_INDEX_BY_ID[route.cluster];
  const clusterStart = -Math.PI / 2 + clusterIndex * (Math.PI / 2);
  const siblings = ROUTES_BY_CLUSTER[route.cluster];
  const siblingIndex = siblings.findIndex((candidate) => candidate.key === route.key);
  const lane = siblingIndex >= 0 ? siblingIndex : index;
  const spread = Math.PI / 2 * 0.82;
  const t = siblings.length <= 1 ? 0.5 : lane / (siblings.length - 1);
  return clusterStart - spread / 2 + t * spread;
}

function hotspotStyle(route: SiteRouteEntry, index: number): React.CSSProperties {
  const angle = routeAngle(route, index);
  const radiusX = route.homePriority ? 38 : 43;
  const radiusY = route.homePriority ? 31 : 35;
  const x = (Math.cos(angle) * radiusX).toFixed(4);
  const y = (Math.sin(angle) * radiusY).toFixed(4);
  return {
    left: `calc(50% + ${x}%)`,
    top: `calc(50% + ${y}%)`,
  };
}

function dominantConcern(concerns: Record<ConcernKey, number>): ConcernKey {
  return (Object.entries(concerns) as Array<[ConcernKey, number]>)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "memory";
}

export default function HomeCabinet() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const patinaRef = useRef<HomeCabinetPatina>(blankPatina());
  const activeKeyRef = useRef("atlas");
  const clusterRef = useRef<SiteRouteCluster>("field");
  const pointerRef = useRef({ x: 0, y: 0, pulse: 0 });
  const saveTimerRef = useRef<number | null>(null);
  const lastFeedbackRef = useRef(0);

  const concerns = useField((state) => state.concerns);
  const keptReadings = useField((state) => state.keptReadings);
  const loadFromStorage = useField((state) => state.loadFromStorage);
  const [activeKey, setActiveKey] = useState("atlas");
  const [selectedCluster, setSelectedCluster] = useState<SiteRouteCluster>("field");
  const [patina, setPatina] = useState<HomeCabinetPatina>(blankPatina());

  const activeRoute = SITE_ROUTE_BY_KEY[activeKey];
  const activeLocal = LOCAL_ENTRY_BY_KEY[activeKey];
  const activeLabel = activeRoute?.key ?? activeLocal?.label ?? SITE_ROUTE_BY_KEY.atlas.key;
  const activeDesc = activeRoute?.desc ?? activeLocal?.desc ?? SITE_ROUTE_BY_KEY.atlas.desc;
  const activeCluster = CLUSTER_BY_ID[selectedCluster];
  const routesInCluster = useMemo(() => clusterRoutes(selectedCluster), [selectedCluster]);
  const topConcern = useMemo(() => dominantConcern(concerns), [concerns]);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const loaded = safePatina(readStoredPatina());
    const next = { ...loaded, visits: loaded.visits + 1 };
    patinaRef.current = next;
    clusterRef.current = next.cluster;
    setPatina(next);
    setSelectedCluster(next.cluster);
    savePatina(next);
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
      savePatina(patinaRef.current);
    };
  }, []);

  const persistLater = useCallback((next: HomeCabinetPatina) => {
    patinaRef.current = next;
    setPatina(next);
    if (typeof window === "undefined") return;
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => savePatina(patinaRef.current), 250);
  }, []);

  const addPatina = useCallback((routeKey: string, cluster: SiteRouteCluster, amount: number) => {
    const current = patinaRef.current;
    const next = {
      glow: Math.min(80, current.glow + amount),
      visits: current.visits,
      cluster,
      routes: {
        ...current.routes,
        [routeKey]: (current.routes[routeKey] ?? 0) + 1,
      },
    };
    persistLater(next);
  }, [persistLater]);

  const selectRoute = useCallback((route: SiteRouteEntry, source: "hover" | "focus" | "activate" = "hover") => {
    activeKeyRef.current = route.key;
    clusterRef.current = route.cluster;
    setActiveKey(route.key);
    setSelectedCluster(route.cluster);
    if (source === "hover") return;
    pointerRef.current.pulse = 1;
    addPatina(route.key, route.cluster, source === "activate" ? 1.2 : 0.22);
    useField.getState().recordTape("sigil", source === "activate" ? 0.72 : 0.34, `home/${route.key}`);
    const now = performance.now();
    if (source !== "activate" && now - lastFeedbackRef.current < 110) return;
    lastFeedbackRef.current = now;
    try {
      const cluster = CLUSTER_BY_ID[route.cluster];
      getFieldAudio().playNote(cluster.pitch + Math.min(12, Math.max(0, route.key.length)), source === "activate" ? 110 : 64);
    } catch { /* noop */ }
    try { source === "activate" ? haptics.ripple(0.45) : haptics.tap(); } catch { /* noop */ }
  }, [addPatina]);

  const selectCluster = useCallback((cluster: SiteRouteCluster, source: "focus" | "activate" = "activate") => {
    clusterRef.current = cluster;
    setSelectedCluster(cluster);
    const first = clusterRoutes(cluster)[0];
    if (first) selectRoute(first, source);
  }, [selectRoute]);

  const scrollToAnchor = useCallback((anchor: string, meta: string) => {
    const element = document.getElementById(anchor);
    if (!element) return;
    pointerRef.current.pulse = 1;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    addPatina(meta, "field", 0.8);
    try { haptics.ripple(0.4); } catch { /* noop */ }
    try { getFieldAudio().chime(); } catch { /* noop */ }
    useField.getState().recordTape("region", 0.58, `home/${meta}`);
    if (anchor === "live-chart") {
      try {
        window.dispatchEvent(new CustomEvent("oda:sea-nudge", { detail: { direction: 1, source: "home-cabinet" } }));
      } catch { /* noop */ }
    }
  }, [addPatina]);

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointerRef.current.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    pointerRef.current.pulse = 1;
    addPatina(`surface-${selectedCluster}`, selectedCluster, 0.18);
    try { haptics.tap(); } catch { /* noop */ }
    try { getFieldAudio().playNote(activeCluster.pitch, 70); } catch { /* noop */ }
    useField.getState().recordTape("ripple", 0.32, `home/${selectedCluster}`);
  };

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = reduceMotion.matches;
    const updateReduce = () => { reduce = reduceMotion.matches; };
    reduceMotion.addEventListener?.("change", updateReduce);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.pointerEvents = "none";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    camera.position.set(0, 0, 14);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.03);
    room.dispose();
    scene.environment = env.texture;

    const root = new THREE.Group();
    scene.add(root);

    const gold = new THREE.MeshPhysicalMaterial({
      color: 0xd8a94a,
      metalness: 1,
      roughness: 0.22,
      clearcoat: 0.7,
      clearcoatRoughness: 0.16,
      emissive: 0x2a1702,
      emissiveIntensity: 0.12,
    });
    const darkGold = new THREE.MeshStandardMaterial({
      color: 0x7c5a1e,
      metalness: 1,
      roughness: 0.28,
      emissive: 0x110802,
      emissiveIntensity: 0.1,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x9ee4e0,
      metalness: 0,
      roughness: 0.06,
      transmission: 0.46,
      thickness: 0.9,
      ior: 1.45,
      transparent: true,
      opacity: 0.72,
      emissive: 0x113a3c,
      emissiveIntensity: 0.28,
    });
    const candle = new THREE.MeshStandardMaterial({
      color: 0xffd681,
      metalness: 0.35,
      roughness: 0.18,
      emissive: 0x8c4a05,
      emissiveIntensity: 0.4,
    });

    const mainRing = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.08, 16, 220), gold);
    root.add(mainRing);
    const crossRing = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.045, 12, 180), darkGold);
    crossRing.rotation.x = Math.PI / 2;
    root.add(crossRing);
    const tiltedRing = new THREE.Mesh(new THREE.TorusGeometry(3.75, 0.04, 12, 180), gold);
    tiltedRing.rotation.set(Math.PI / 2.9, 0.22, 0.1);
    root.add(tiltedRing);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 32), glass);
    root.add(lens);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 2), candle);
    root.add(core);

    const rodMaterial = new THREE.LineBasicMaterial({ color: 0xdfc06a, transparent: true, opacity: 0.28 });
    const routeGemGeometry = new THREE.IcosahedronGeometry(0.18, 1);
    const routeGems = SITE_ROUTES.map((route, index) => {
      const angle = routeAngle(route, index);
      const cluster = CLUSTER_BY_ID[route.cluster];
      const material = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(cluster.color),
        metalness: 0.08,
        roughness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        emissive: new THREE.Color(cluster.color),
        emissiveIntensity: route.homePriority ? 0.22 : 0.08,
      });
      const radius = route.homePriority ? 4.2 : 4.75;
      const z = route.homePriority ? 0.34 : -0.12;
      const mesh = new THREE.Mesh(routeGemGeometry, material);
      mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.78, z);
      mesh.scale.setScalar(route.homePriority ? 1.2 : 0.9);
      root.add(mesh);

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, -0.02),
          new THREE.Vector3(mesh.position.x, mesh.position.y, -0.02),
        ]),
        rodMaterial,
      );
      root.add(line);
      return { route, mesh, material, line, baseScale: route.homePriority ? 1.2 : 0.9, angle };
    });

    const dustCount = 540;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustColors = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i += 1) {
      const a = i * 12.9898;
      const r = 5.2 + ((Math.sin(a) * 43758.5453) % 1 + 1) % 1 * 3.8;
      const theta = ((Math.sin(a * 1.7) * 43758.5453) % 1 + 1) % 1 * Math.PI * 2;
      dustPositions[i * 3] = Math.cos(theta) * r;
      dustPositions[i * 3 + 1] = Math.sin(theta) * r * 0.62;
      dustPositions[i * 3 + 2] = -1.6 + (((Math.sin(a * 2.3) * 9999) % 1 + 1) % 1) * 2.6;
      const cluster = CLUSTERS[i % CLUSTERS.length];
      const color = new THREE.Color(cluster.color).lerp(new THREE.Color(0xfff2bf), 0.35);
      dustColors[i * 3] = color.r;
      dustColors[i * 3 + 1] = color.g;
      dustColors[i * 3 + 2] = color.b;
    }
    const dust = new THREE.Points(
      new THREE.BufferGeometry()
        .setAttribute("position", new THREE.BufferAttribute(dustPositions, 3))
        .setAttribute("color", new THREE.BufferAttribute(dustColors, 3)),
      new THREE.PointsMaterial({
        size: 0.036,
        vertexColors: true,
        transparent: true,
        opacity: 0.56,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(dust);

    const key = new THREE.DirectionalLight(0xfff0c4, 3.2);
    key.position.set(3, 4, 6);
    scene.add(key);
    const sea = new THREE.PointLight(0x68d8d0, 2.4, 22);
    sea.position.set(-4, -2, 4);
    scene.add(sea);
    const rose = new THREE.PointLight(0xd7b4ff, 1.7, 18);
    rose.position.set(4, 1.8, 5);
    scene.add(rose);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let last = performance.now();
    let glowEase = patinaRef.current.glow;
    let rotX = 0;
    let rotY = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now * 0.001;
      const motion = reduce ? 0 : 1;
      const pointer = pointerRef.current;
      pointer.pulse *= 0.92;
      glowEase += (patinaRef.current.glow - glowEase) * 0.035;
      const level = 1 - Math.exp(-glowEase * 0.055);

      rotY += (pointer.x * 0.26 - rotY) * 0.06;
      rotX += (-pointer.y * 0.16 - rotX) * 0.06;
      root.rotation.y = rotY + Math.sin(t * 0.16) * 0.05 * motion;
      root.rotation.x = rotX + Math.cos(t * 0.19) * 0.035 * motion;
      mainRing.rotation.z = t * 0.035 * motion;
      crossRing.rotation.z = -t * 0.06 * motion;
      tiltedRing.rotation.z = t * 0.044 * motion;
      lens.scale.setScalar(1 + Math.sin(t * 1.2) * 0.018 * motion + pointer.pulse * 0.04);
      core.rotation.y = t * 0.5 * motion;
      core.rotation.z = -t * 0.36 * motion;
      (candle as THREE.MeshStandardMaterial).emissiveIntensity = 0.35 + pointer.pulse * 0.8 + level * 0.3;
      (glass as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.22 + pointer.pulse * 0.18 + level * 0.22;

      const active = activeKeyRef.current;
      const cluster = clusterRef.current;
      routeGems.forEach(({ route, mesh, material, baseScale, angle }) => {
        const isActive = route.key === active;
        const isCluster = route.cluster === cluster;
        const targetScale = baseScale * (isActive ? 1.68 : isCluster ? 1.16 : 0.88);
        mesh.scale.setScalar(mesh.scale.x + (targetScale - mesh.scale.x) * 0.12);
        mesh.rotation.x += dt * (0.9 + baseScale) * motion;
        mesh.rotation.y += dt * 0.8 * motion;
        mesh.position.z = (route.homePriority ? 0.34 : -0.12) + Math.sin(t * 0.9 + angle * 3) * 0.08 * motion + (isActive ? 0.26 : 0);
        material.emissiveIntensity = (isActive ? 0.84 : isCluster ? 0.34 : 0.08) + pointer.pulse * 0.12 + level * 0.18;
      });
      dust.rotation.z = -t * 0.015 * motion;
      (dust.material as THREE.PointsMaterial).opacity = 0.34 + level * 0.24 + pointer.pulse * 0.16;
      sea.intensity = 1.7 + level * 1.2 + pointer.pulse * 0.8;
      rose.intensity = 1.1 + level * 1.0;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    (window as unknown as Record<string, unknown>).__homeCabinet = {
      ready: true,
      selectRoute: (key: string) => {
        const route = SITE_ROUTE_BY_KEY[key];
        if (route) {
          activeKeyRef.current = route.key;
          clusterRef.current = route.cluster;
          setActiveKey(route.key);
          setSelectedCluster(route.cluster);
        }
      },
      setCluster: (cluster: SiteRouteCluster) => {
        if (CLUSTER_BY_ID[cluster]) {
          clusterRef.current = cluster;
          setSelectedCluster(cluster);
        }
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      reduceMotion.removeEventListener?.("change", updateReduce);
      delete (window as unknown as Record<string, unknown>).__homeCabinet;
      routeGems.forEach(({ material, line }) => {
        material.dispose();
        line.geometry.dispose();
      });
      routeGemGeometry.dispose();
      rodMaterial.dispose();
      mainRing.geometry.dispose();
      crossRing.geometry.dispose();
      tiltedRing.geometry.dispose();
      lens.geometry.dispose();
      core.geometry.dispose();
      gold.dispose();
      darkGold.dispose();
      glass.dispose();
      candle.dispose();
      dust.geometry.dispose();
      (dust.material as THREE.PointsMaterial).dispose();
      renderer.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <section
      id="threshold"
      className="home-cabinet"
      data-touch-surface="true"
      data-pretext-ignore="true"
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      style={{
        ["--active-color" as string]: activeCluster.color,
        ["--active-glow" as string]: activeCluster.glow,
      }}
    >
      <div className="home-cabinet__scene" ref={stageRef} aria-hidden="true" />

      <div className="home-cabinet__grain" aria-hidden="true" />

      <div className="home-cabinet__title">
        <p className="t-eyebrow">home instrument</p>
        <h1>Cabinet of Currents</h1>
        <p className="home-cabinet__route-line">
          <span>{activeLabel}</span>
          <span>{activeDesc}</span>
        </p>
      </div>

      <div className="home-cabinet__lens" aria-label={`current field, strongest at ${topConcern}`}>
        <ConcernSigil
          concerns={concerns}
          size={150}
          showAxes
          showDots
          stroke="rgba(255,242,191,0.94)"
          fill="rgba(105,216,208,0.10)"
        />
        <div className="home-cabinet__lens-meta">
          <span>{topConcern}</span>
          <span>{keptReadings.length ? `${keptReadings.length} kept` : `${Math.round(patina.glow)} glow`}</span>
        </div>
      </div>

      <div className="home-cabinet__local" aria-label="home instruments">
        {LOCAL_ENTRIES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-label={`${entry.label}: ${entry.desc}`}
            onClick={() => scrollToAnchor(entry.anchor, entry.key)}
            onFocus={() => {
              activeKeyRef.current = entry.key === "reading" ? "kept" : entry.key;
              setActiveKey(entry.key === "reading" ? "kept" : entry.key);
              setSelectedCluster("field");
              clusterRef.current = "field";
            }}
          >
            <RouteSigil kind={entry.icon} size={18} />
            <span>{entry.label}</span>
          </button>
        ))}
      </div>

      <div className="home-cabinet__clusters" aria-label="route currents">
        {CLUSTERS.map((cluster) => (
          <button
            key={cluster.id}
            type="button"
            className={selectedCluster === cluster.id ? "is-active" : ""}
            style={{ ["--cluster-color" as string]: cluster.color }}
            aria-pressed={selectedCluster === cluster.id}
            onClick={() => selectCluster(cluster.id, "activate")}
            onFocus={() => selectCluster(cluster.id, "focus")}
          >
            <span>{cluster.label}</span>
            <small>{cluster.desc}</small>
          </button>
        ))}
      </div>

      <nav className="home-cabinet__ring" aria-label="route constellation">
        {SITE_ROUTES.map((route, index) => (
          <Link
            key={route.key}
            href={route.anchor ? `#${route.anchor}` : route.href}
            className={`home-cabinet__hotspot${activeKey === route.key ? " is-active" : ""}${selectedCluster === route.cluster ? " is-cluster" : ""}`}
            style={{
              ...hotspotStyle(route, index),
              ["--route-color" as string]: CLUSTER_BY_ID[route.cluster].color,
            }}
            aria-label={`${route.key}: ${route.desc}`}
            onMouseEnter={() => selectRoute(route)}
            onFocus={() => selectRoute(route, "focus")}
            onClick={(event) => {
              selectRoute(route, "activate");
              if (route.anchor) {
                event.preventDefault();
                scrollToAnchor(route.anchor, route.key);
              }
            }}
          >
            <RouteSigil kind={route.icon} size={18} />
            <span>{route.key}</span>
          </Link>
        ))}
      </nav>

      <nav className="home-cabinet__drawer" aria-label={`${activeCluster.label} routes`}>
        {routesInCluster.map((route) => (
          <Link
            key={route.key}
            href={route.anchor ? `#${route.anchor}` : route.href}
            className={activeKey === route.key ? "is-active" : ""}
            onMouseEnter={() => selectRoute(route)}
            onFocus={() => selectRoute(route, "focus")}
            onClick={(event) => {
              selectRoute(route, "activate");
              if (route.anchor) {
                event.preventDefault();
                scrollToAnchor(route.anchor, route.key);
              }
            }}
          >
            <RouteSigil kind={route.icon} size={17} />
            <span>{route.key}</span>
          </Link>
        ))}
      </nav>

      <div className="home-cabinet__edge" aria-hidden="true">
        <span />
      </div>

      <style>{`
        .home-cabinet {
          position: relative;
          min-height: calc(100svh - 152px);
          padding: 0;
          overflow: hidden;
          isolation: isolate;
          color: rgba(255, 244, 207, 0.94);
          background:
            radial-gradient(circle at 50% 44%, var(--active-glow), transparent 31%),
            radial-gradient(circle at 22% 20%, rgba(105,216,208,0.16), transparent 28%),
            radial-gradient(circle at 78% 18%, rgba(231,185,78,0.14), transparent 30%),
            linear-gradient(180deg, #060b12 0%, #0b1720 54%, #132532 100%);
          touch-action: pan-y;
        }
        .home-cabinet__scene {
          position: absolute;
          inset: 0;
          z-index: 0;
        }
        .home-cabinet__grain {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background:
            linear-gradient(180deg, rgba(255,244,207,0.04), transparent 22%, rgba(2,7,12,0.22)),
            repeating-linear-gradient(92deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 5px);
          mix-blend-mode: screen;
          opacity: 0.56;
        }
        .home-cabinet__title {
          position: relative;
          z-index: 3;
          width: min(560px, calc(100vw - var(--pad-x) * 2));
          padding: clamp(38px, 8vh, 78px) var(--pad-x) 0;
          pointer-events: none;
        }
        .home-cabinet__title .t-eyebrow {
          color: rgba(255,244,207,0.58);
          letter-spacing: 0;
          margin: 0 0 12px;
        }
        .home-cabinet__title h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: clamp(46px, 8vw, 102px);
          line-height: 0.92;
          font-weight: 300;
          letter-spacing: 0;
          text-wrap: balance;
          text-shadow: 0 20px 70px rgba(0,0,0,0.58);
        }
        .home-cabinet__route-line {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 14px;
          margin: 20px 0 0;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
          color: rgba(255,244,207,0.62);
        }
        .home-cabinet__route-line span:first-child {
          color: var(--active-color);
        }
        .home-cabinet__lens {
          position: absolute;
          z-index: 4;
          left: 50%;
          top: 50%;
          width: 184px;
          min-height: 214px;
          transform: translate(-50%, -50%);
          display: grid;
          place-items: center;
          pointer-events: none;
          filter: drop-shadow(0 18px 46px rgba(0,0,0,0.4));
        }
        .home-cabinet__lens-meta {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: -8px;
          font-family: var(--font-text);
          font-size: 11px;
          letter-spacing: 0;
          text-transform: lowercase;
          color: rgba(255,244,207,0.68);
        }
        .home-cabinet__lens-meta span:first-child {
          color: var(--active-color);
        }
        .home-cabinet__local,
        .home-cabinet__clusters,
        .home-cabinet__drawer {
          position: absolute;
          z-index: 5;
          pointer-events: auto;
        }
        .home-cabinet__local {
          left: var(--pad-x);
          bottom: calc(68px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: repeat(4, minmax(78px, 1fr));
          gap: 8px;
          width: min(560px, calc(100vw - var(--pad-x) * 2));
        }
        .home-cabinet__local button,
        .home-cabinet__clusters button,
        .home-cabinet__drawer a,
        .home-cabinet__hotspot {
          min-height: 44px;
          color: rgba(255,244,207,0.88);
          font-family: var(--font-text);
          letter-spacing: 0;
          text-transform: lowercase;
          cursor: pointer;
        }
        .home-cabinet__local button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid rgba(255,244,207,0.18);
          border-radius: 8px;
          background: rgba(5, 10, 16, 0.48);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          font-size: 12px;
          transition: border-color var(--t), color var(--t), background var(--t), transform var(--t);
        }
        .home-cabinet__local button:hover,
        .home-cabinet__local button:focus-visible {
          border-color: var(--active-color);
          color: #fff6da;
          background: rgba(255,244,207,0.08);
          transform: translateY(-1px);
        }
        .home-cabinet__clusters {
          right: var(--pad-x);
          top: clamp(86px, 15vh, 146px);
          display: grid;
          gap: 8px;
          width: min(244px, 28vw);
        }
        .home-cabinet__clusters button {
          min-width: 0;
          display: grid;
          gap: 3px;
          text-align: left;
          border: 1px solid rgba(255,244,207,0.14);
          border-radius: 8px;
          background: rgba(5, 10, 16, 0.42);
          padding: 10px 12px;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          transition: border-color var(--t), color var(--t), background var(--t);
        }
        .home-cabinet__clusters button span {
          color: rgba(255,244,207,0.92);
          font-size: 12px;
        }
        .home-cabinet__clusters button small {
          color: rgba(255,244,207,0.48);
          font-size: 10px;
          line-height: 1.25;
        }
        .home-cabinet__clusters button:hover,
        .home-cabinet__clusters button:focus-visible,
        .home-cabinet__clusters button.is-active {
          border-color: var(--cluster-color);
          background: rgba(255,244,207,0.07);
        }
        .home-cabinet__clusters button.is-active span {
          color: var(--cluster-color);
        }
        .home-cabinet__ring {
          position: absolute;
          inset: 0;
          z-index: 4;
          pointer-events: none;
        }
        .home-cabinet__hotspot {
          position: absolute;
          width: 50px;
          height: 50px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          border: 1px solid rgba(255,244,207,0.12);
          background: rgba(5, 10, 16, 0.12);
          color: rgba(255,244,207,0.36);
          transform: translate(-50%, -50%);
          pointer-events: auto;
          transition: color var(--t), border-color var(--t), background var(--t), transform var(--t), opacity var(--t);
          opacity: 0.66;
        }
        .home-cabinet__hotspot span {
          position: absolute;
          left: 50%;
          top: calc(100% + 5px);
          transform: translateX(-50%);
          opacity: 0;
          padding: 4px 7px;
          border-radius: 6px;
          background: rgba(5,10,16,0.74);
          border: 1px solid rgba(255,244,207,0.12);
          color: rgba(255,244,207,0.8);
          font-size: 10px;
          white-space: nowrap;
          transition: opacity var(--t);
        }
        .home-cabinet__hotspot.is-cluster {
          color: var(--route-color);
          border-color: color-mix(in srgb, var(--route-color) 46%, transparent);
          opacity: 0.94;
        }
        .home-cabinet__hotspot:hover,
        .home-cabinet__hotspot:focus-visible,
        .home-cabinet__hotspot.is-active {
          color: #fff6da;
          border-color: var(--route-color);
          background: rgba(255,244,207,0.08);
          transform: translate(-50%, -50%) scale(1.12);
          opacity: 1;
        }
        .home-cabinet__hotspot:hover span,
        .home-cabinet__hotspot:focus-visible span,
        .home-cabinet__hotspot.is-active span {
          opacity: 1;
        }
        .home-cabinet__drawer {
          right: calc(var(--pad-x) + 300px);
          bottom: calc(68px + env(safe-area-inset-bottom, 0px));
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 7px;
          width: min(500px, calc(100vw - var(--pad-x) * 2 - 340px));
        }
        .home-cabinet__drawer a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-width: 82px;
          padding: 0 10px;
          border: 1px solid rgba(255,244,207,0.14);
          border-radius: 8px;
          background: rgba(5, 10, 16, 0.38);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          font-size: 11px;
          transition: border-color var(--t), color var(--t), background var(--t);
        }
        .home-cabinet__drawer a:hover,
        .home-cabinet__drawer a:focus-visible,
        .home-cabinet__drawer a.is-active {
          color: #fff6da;
          border-color: var(--active-color);
          background: rgba(255,244,207,0.08);
        }
        .home-cabinet__edge {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2;
          height: 54px;
          pointer-events: none;
          background: linear-gradient(180deg, transparent, rgba(242,238,230,0.08));
        }
        .home-cabinet__edge span {
          position: absolute;
          left: 50%;
          bottom: 14px;
          width: 42px;
          height: 1px;
          transform: translateX(-50%);
          background: rgba(255,244,207,0.34);
        }
        @media (max-width: 980px) {
          .home-cabinet {
            min-height: calc(100svh - 140px);
          }
          .home-cabinet__title {
            width: min(680px, calc(100vw - 28px));
            padding: 28px 14px 0;
          }
          .home-cabinet__title h1 {
            font-size: clamp(42px, 13vw, 72px);
            max-width: 9ch;
          }
          .home-cabinet__ring {
            display: none;
          }
          .home-cabinet__clusters {
            left: 14px;
            right: 14px;
            top: auto;
            bottom: calc(180px + env(safe-area-inset-bottom, 0px));
            width: auto;
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .home-cabinet__clusters button {
            min-height: 50px;
            text-align: center;
            padding: 8px 6px;
          }
          .home-cabinet__clusters button small {
            display: none;
          }
          .home-cabinet__drawer {
            left: 14px;
            right: 14px;
            bottom: calc(112px + env(safe-area-inset-bottom, 0px));
            width: auto;
            justify-content: flex-start;
            overflow-x: auto;
            flex-wrap: nowrap;
            padding-bottom: 3px;
            overscroll-behavior-x: contain;
            -webkit-overflow-scrolling: touch;
          }
          .home-cabinet__drawer a {
            flex: 0 0 auto;
          }
          .home-cabinet__local {
            left: 14px;
            right: 14px;
            bottom: calc(50px + env(safe-area-inset-bottom, 0px));
            width: auto;
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .home-cabinet__local button {
            padding: 0 6px;
            font-size: 11px;
          }
          .home-cabinet__lens {
            width: 156px;
            min-height: 180px;
            transform: translate(-50%, -40%);
          }
          .home-cabinet__lens svg {
            width: 124px;
            height: 124px;
          }
        }
        @media (max-width: 560px) {
          .home-cabinet__route-line {
            max-width: 31ch;
          }
          .home-cabinet__local button span {
            display: none;
          }
          .home-cabinet__local button {
            min-width: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .home-cabinet__local button,
          .home-cabinet__clusters button,
          .home-cabinet__drawer a,
          .home-cabinet__hotspot {
            transition: none;
          }
        }
      `}</style>
    </section>
  );
}

function savePatina(patina: HomeCabinetPatina) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        glow: +patina.glow.toFixed(3),
        visits: patina.visits,
        cluster: patina.cluster,
        routes: patina.routes,
      }),
    );
  } catch { /* noop */ }
}

function readStoredPatina(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
