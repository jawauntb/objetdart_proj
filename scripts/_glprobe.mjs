// Compile the generated heightfield GLSL in a real driver and read numbers back.
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import * as ts from "typescript";
function load(p){const fn="/home/user/objetdart_proj/"+p;const src=readFileSync(fn,"utf8");
const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},fileName:fn}).outputText;
const m={exports:{}};new Function("module","exports",code)(m,m.exports);return m.exports;}
const F = load("src/lib/heightfield.ts");
const SEED = 0x0a1a;
const off = F.seedOffset(SEED);
const horns = F.packHorns(SEED);
const st = F.stationFor(SEED);
const bearing = F.viewBearingFor(st, SEED);
const yaw = bearing + 0.16;
console.log("node: station", st, "yaw", yaw, "restingFog", F.restingFogAltitude(SEED));

// probe points: the eye, and rays down the view bearing
const probes = [];
for (const d of [0, 0.02, 0.05, 0.1, 0.3, 1, 2, 4, 8, 16]) {
  probes.push([st.x + Math.sin(yaw) * d, st.z + Math.cos(yaw) * d]);
}
const FRAG = `
precision highp float;
${F.heightfieldGlsl()}
uniform vec2 uProbe;
uniform int uOct;
uniform int uMode;
uniform vec3 uRo;
uniform vec3 uRd;
vec4 packF(float v){
  float x = clamp(v / 64.0 + 0.5, 0.0, 1.0);
  vec4 enc = fract(x * vec4(1.0, 255.0, 65025.0, 16581375.0));
  enc -= enc.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0);
  return enc;
}
void main(){
  float out_ = 0.0;
  if (uMode == 0) out_ = hf_heightAt(uProbe, uOct);
  else if (uMode == 1) { float t; bool h = hf_marchTerrain(uRo, uRd, uOct, MARCH_STEPS, MARCH_REFINE, t); out_ = h ? t : -t; }
  else if (uMode == 2) out_ = hf_hash21(uProbe);
  gl_FragColor = packF(out_);
}`;
const VERT = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos,0.0,1.0); }`;
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(EXE) ? EXE : undefined,
  args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"] });
const page = await browser.newPage();
const res = await page.evaluate(({ FRAG, VERT, off, ha, hb, probes, ro, rd, marchOct, shadeOct }) => {
  const c = document.createElement("canvas"); c.width = 1; c.height = 1;
  const gl = c.getContext("webgl");
  if (!gl) return { err: "no gl" };
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return { log: gl.getShaderInfoLog(sh) }; return sh; };
  const vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FRAG);
  if (vs.log) return { err: "vs " + vs.log };
  if (fs.log) return { err: "fs " + fs.log };
  const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return { err: "link " + gl.getProgramInfoLog(p) };
  gl.useProgram(p);
  const q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, "a_pos"); gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(p, n);
  gl.uniform2f(u("uSeedOffset"), off[0], off[1]);
  gl.uniform4fv(u("uHornA"), new Float32Array(ha));
  gl.uniform4fv(u("uHornB"), new Float32Array(hb));
  gl.viewport(0,0,1,1);
  const px = new Uint8Array(4);
  const read = () => { gl.drawArrays(gl.TRIANGLE_STRIP,0,4); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
    const x = px[0]/255 + px[1]/65025 + px[2]/16581375 + px[3]/4228250625; return (x - 0.5) * 64.0; };
  const heights = [];
  for (const pr of probes) {
    gl.uniform1i(u("uMode"), 0); gl.uniform1i(u("uOct"), marchOct); gl.uniform2f(u("uProbe"), pr[0], pr[1]);
    const hm = read();
    gl.uniform1i(u("uOct"), shadeOct);
    heights.push([hm, read()]);
  }
  gl.uniform1i(u("uMode"), 1); gl.uniform1i(u("uOct"), marchOct);
  gl.uniform3f(u("uRo"), ro[0], ro[1], ro[2]);
  const marches = [];
  for (const d of rd) { gl.uniform3f(u("uRd"), d[0], d[1], d[2]); marches.push(read()); }
  gl.uniform1i(u("uMode"), 2);
  const hashes = [];
  for (const pr of [[0,0],[3,5],[-7,120],[288,288],[1000,-1000]]) { gl.uniform2f(u("uProbe"), pr[0], pr[1]); hashes.push(read()); }
  return { heights, marches, hashes };
}, { FRAG, VERT, off, ha: Array.from(horns.a), hb: Array.from(horns.b),
     probes, ro: [st.x, st.y, st.z],
     rd: [[Math.sin(yaw),0.17,Math.cos(yaw)],[Math.sin(yaw),0.02,Math.cos(yaw)],[Math.sin(yaw),0,Math.cos(yaw)],[Math.sin(yaw),-0.06,Math.cos(yaw)],[Math.sin(yaw),-0.2,Math.cos(yaw)],[0,1,0]],
     marchOct: F.OCTAVES_MARCH, shadeOct: F.OCTAVES_SHADE });
await browser.close();
if (res.err) { console.log("SHADER ERROR:", res.err); process.exit(1); }
console.log("\nhash21  gl vs node:");
[[0,0],[3,5],[-7,120],[288,288],[1000,-1000]].forEach((p,i)=>console.log("  ",p, res.hashes[i].toFixed(6), F.hash21(p[0],p[1]).toFixed(6)));
console.log("\nheightAt along the view bearing (gl march / gl shade / node march / node shade):");
[0,0.02,0.05,0.1,0.3,1,2,4,8,16].forEach((d,i)=>{
  const [x,z]=probes[i];
  console.log(`  d=${String(d).padEnd(5)} ${res.heights[i][0].toFixed(4)} ${res.heights[i][1].toFixed(4)} | ${F.heightAt(x,z,SEED,F.OCTAVES_MARCH).toFixed(4)} ${F.heightAt(x,z,SEED,F.OCTAVES_SHADE).toFixed(4)}`);
});
console.log("\nmarch from the eye (gl t; negative = miss):");
[["+0.17"],["+0.02"],["0"],["-0.06"],["-0.2"],["straight up"]].forEach((n,i)=>console.log("  rd.y",n[0],res.marches[i].toFixed(3)));
const rds=[[Math.sin(yaw),0.17,Math.cos(yaw)],[Math.sin(yaw),0.02,Math.cos(yaw)],[Math.sin(yaw),0,Math.cos(yaw)],[Math.sin(yaw),-0.06,Math.cos(yaw)],[Math.sin(yaw),-0.2,Math.cos(yaw)],[0,1,0]];
console.log("node march:", rds.map(d=>{const m=F.marchTerrain([st.x,st.y,st.z],d,SEED);return (m.hit?"":"-")+m.t.toFixed(3);}).join(" "));
