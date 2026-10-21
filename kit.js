// Peças compartilhadas pelos cenários: céu, materiais, água, pessoas, árvores e janelas.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { fbm } from './textures.js';

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/* ---------- Céu paramétrico (gradiente + sol + estrelas opcionais) ---------- */
export function makeSky({ top, horizon, bottom, sun, sunColor = '#ffd2a0', sunSize = 900, glow = 0.35, stars = 0 }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(top) }, uHor: { value: new THREE.Color(horizon) }, uBot: { value: new THREE.Color(bottom) },
      uSun: { value: sun.clone().normalize() }, uSunCol: { value: new THREE.Color(sunColor) },
      uSize: { value: sunSize }, uGlow: { value: glow }, uStars: { value: stars }, uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHor, uBot, uSun, uSunCol; uniform float uSize, uGlow, uStars, uTime; varying vec3 vDir;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = mix(uHor, uTop, pow(smoothstep(-0.02, 0.6, h), 0.6));
        col = mix(col, uBot, smoothstep(0.0, -0.08, h));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += uSunCol * (pow(s, uSize) * 5.0 + pow(s, 40.0) * uGlow + pow(s, 6.0) * uGlow * 0.4);
        if (uStars > 0.0 && h > 0.05) {
          vec2 g = floor(d.xz / (h + 0.3) * 260.0);
          float st = step(0.9965, h21(g));
          col += vec3(st) * uStars * (0.6 + 0.4 * sin(uTime * 2.0 + h21(g + 3.0) * 40.0)) * smoothstep(0.05, 0.4, h);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 40, 20), mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function envFromSky(renderer, sky) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(sky.geometry, sky.material));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0, 0.1, 600).texture;
  pm.dispose();
  return tex;
}

/* ---------- HDRI (Poly Haven, CC0) ---------- */
// Carrega em segundo plano (nunca bloqueia o primeiro quadro), gira o panorama para o sol do HDRI
// coincidir com o sol da cena e corta o pico do sol no mapa de ambiente (a DirectionalLight já faz esse papel).
// A decodificação e a rotação rodam num Worker (hdr-worker.js); aqui só sobem as texturas e o PMREM.
let hdrWorker = null, hdrJobs = 0;
const hdrWaiting = new Map();
function hdrJob(msg) {
  if (!hdrWorker) {
    hdrWorker = new Worker(new URL('./hdr-worker.js', import.meta.url));
    hdrWorker.onmessage = ({ data }) => { const p = hdrWaiting.get(data.id); hdrWaiting.delete(data.id); data.error ? p.rej(new Error(data.error)) : p.res(data); };
  }
  return new Promise((res, rej) => { const id = ++hdrJobs; hdrWaiting.set(id, { res, rej }); hdrWorker.postMessage({ id, ...msg }); });
}
export async function loadHDR(renderer, name, { mobile, sunDir, clamp = 60, background = false } = {}) {
  const url = new URL(`assets/hdri/${name}_${mobile ? '1k' : '2k'}.hdr`, document.baseURI).href;
  const r = await hdrJob({ url, sunAz: sunDir ? Math.atan2(sunDir.z, sunDir.x) : null, clamp });
  const make = (arr, w = r.w, h = r.h) => {
    const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    t.colorSpace = THREE.LinearSRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping;
    t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = true; t.needsUpdate = true;
    return t;
  };
  // Ambiente com o pico do sol limitado a `clamp` × o horizonte; fundo com o sol inteiro
  const envSrc = make(r.env, r.ew, r.eh), pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(envSrc).texture;
  pm.dispose(); envSrc.dispose();
  return { env, background: background ? make(r.full) : null, horizon: new THREE.Color(...r.horizon) };
}
// Ajusta a força do ambiente em todos os materiais da cena (o three 0.160 ainda não tem scene.environmentIntensity).
export function envIntensity(scene, k) {
  scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach((m) => { if ('envMapIntensity' in m) { m.userData.envBase ??= m.envMapIntensity; m.envMapIntensity = m.userData.envBase * k; } });
  });
}

/* ---------- Materiais PBR (Poly Haven, CC0, 1K) ---------- */
// Mapas: cor (sRGB), normal (GL) e ARM (R = oclusão, G = rugosidade, B = metal).
// `size` = metros cobertos por uma repetição; as geometrias usam UV em metros (metricUV / uvScale).
const texLoader = new THREE.TextureLoader();
const texFiles = new Map();
const loadTex = (url) => { if (!texFiles.has(url)) texFiles.set(url, texLoader.loadAsync(url)); return texFiles.get(url); };
const pendingLoads = [];
// Cargas pendentes criadas desde a última chamada (cada cenário recolhe as suas para esperar antes de compilar).
export const takeLoads = () => pendingLoads.splice(0);
// `tone`: a cor do material vira o albedo e a textura só entra como variação de luminância (contraste `tone`)
export function pbr(name, { size = 2, normalScale = 1, aoIntensity = 1, normal = true, tone = 0, ...params } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, ...params });
  if (tone) {
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
          diffuseColor.rgb = diffuse * clamp(1.0 + (dot(sampledDiffuseColor.rgb, vec3(0.333)) - ${(+tone.mean || 0.45).toFixed(3)}) * ${(+tone.k || tone).toFixed(3)}, 0.2, 1.6);
        #endif`);
    };
    mat.customProgramCacheKey = () => 'tone' + JSON.stringify(tone);
  }
  const base = `assets/tex/${name}_`;
  mat.userData.ready = Promise.all(['diff', 'nor_gl', 'arm'].map((k) => loadTex(`${base}${k}_1k.jpg`))).then(([d, n, a]) => {
    const [map, nor, arm] = [d, n, a].map((t) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.setScalar(1 / size); c.anisotropy = 8; c.needsUpdate = true;
      return c;
    });
    map.colorSpace = THREE.SRGBColorSpace;
    Object.assign(mat, { map, roughnessMap: arm, aoMap: arm, aoMapIntensity: aoIntensity });
    if (normal) { mat.normalMap = nor; mat.normalScale.setScalar(normalScale); }
    mat.needsUpdate = true;
  }).catch((err) => console.warn('[MONÓLITO] textura', name, err));
  pendingLoads.push(mat.userData.ready);
  return mat;
}
// Multiplica as UVs de uma geometria (planos grandes: UV 0..1 → metros).
export function uvScale(geo, sx, sy = sx) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  return geo;
}
// UVs de uma caixa em metros, face a face (+x, -x, +y, -y, +z, -z), para a textura manter a escala real.
function metricUV(geo, w, h, d) {
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = geo.attributes.uv;
  for (let v = 0; v < uv.count; v++) { const f = Math.floor(v / 4); uv.setXY(v, uv.getX(v) * dims[f][0], uv.getY(v) * dims[f][1]); } // 4 vértices por face
  return geo;
}

/* ---------- Texturas ---------- */
function canvasTex(w, h, paint, srgb = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Fachadas da cidade à noite: `cols` vãos × `rows` andares, cada vão com caixilho, forro e brilho próprios.
export function windowsTexture(cols = 8, rows = 16, lit = 0.4) {
  const bw = 32, bh = 40;
  return canvasTex(cols * bw, rows * bh, (g, w, h) => {
    g.fillStyle = '#0d0f14'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const px = x * bw, py = y * bh, on = Math.random() < lit, warm = Math.random();
      if (on) {
        const cool = warm < 0.25;
        const gr = g.createLinearGradient(0, py + 6, 0, py + bh - 4);
        const c = cool ? [200, 222, 255] : [255, 196 + warm * 40, 130 + warm * 60];
        gr.addColorStop(0, `rgba(${c[0]},${c[1] | 0},${c[2] | 0},1)`); gr.addColorStop(1, `rgba(${c[0]},${c[1] | 0},${c[2] | 0},.45)`);
        g.fillStyle = gr; g.fillRect(px + 3, py + 6, bw - 6, bh - 10);
        if (Math.random() < 0.3) { g.fillStyle = 'rgba(30,24,18,.5)'; for (let k = py + 8; k < py + bh - 4; k += 4) g.fillRect(px + 3, k, bw - 6, 1.5); }
      } else { g.fillStyle = 'rgba(34,40,52,1)'; g.fillRect(px + 3, py + 6, bw - 6, bh - 10); }
    }
  }, true);
}

// Normal de água: ondulações suaves que se repetem.
export function waterNormal() {
  const size = 256, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const H = (x, y) => fbm(x / size * 6, y / size * 6, 6, 4, 77);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H((x + 1) % size, y) - H((x - 1 + size) % size, y)) * 6;
    const dy = (H(x, (y + 1) % size) - H(x, (y - 1 + size) % size)) * 6;
    const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function waterMaterial(color = '#5d7480', repeat = 6) {
  const n = waterNormal();
  n.repeat.set(repeat, repeat);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.04, metalness: 0.15, normalMap: n, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2 });
  m.userData.flow = (t) => { n.offset.set(t * 0.012, t * 0.008); };
  return m;
}

// Espelho d'água com reflexo real (Water/Reflector do three): só no desktop, custa um render extra da cena.
export function mirrorWater(geo, { color = '#2f4a52', sunDir, sunColor = '#fff0dc', size = 1.5, distortion = 0.6, res = 1024 } = {}) {
  const w = new Water(geo, {
    textureWidth: res, textureHeight: res, waterNormals: waterNormal(), sunDirection: sunDir.clone().normalize(),
    sunColor, waterColor: color, distortionScale: distortion, fog: true, alpha: 1,
  });
  w.rotation.x = -Math.PI / 2;
  w.material.uniforms.size.value = size;
  w.userData.flow = (t) => { w.material.uniforms.time.value = t * 0.35; };
  return w;
}

/* ---------- Construção ---------- */
export function box(parent, w, h, d, mat, x, y, z, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(metricUV(new THREE.BoxGeometry(w, h, d), w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = receive;
  parent.add(m);
  return m;
}

/* ---------- Pessoas (silhuetas com proporção de ~7,5 cabeças, escala real ~1,74 m) ---------- */
const shirts = ['#2b2723', '#6b5a48', '#d8cfc2', '#4a4f57', '#8a7a66', '#1f2a36'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const pants = ['#1d1c1b', '#2e3440', '#5a5248'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
const skins = ['#8a6a52', '#c49a7a', '#5e4535'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.65 }));
const hair = new THREE.MeshStandardMaterial({ color: '#1b1612', roughness: 0.75 });
const bodyGeo = { torso: new THREE.CapsuleGeometry(0.16, 0.36, 4, 12), hips: new THREE.CapsuleGeometry(0.15, 0.08, 3, 12), leg: new THREE.CapsuleGeometry(0.062, 0.76, 3, 8), arm: new THREE.CapsuleGeometry(0.043, 0.56, 3, 8), head: new THREE.SphereGeometry(0.1, 16, 12), neck: new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8) };
bodyGeo.leg.translate(0, -0.42, 0); bodyGeo.arm.translate(0, -0.3, 0);
export function person(i = 0) {
  const g = new THREE.Group();
  const top = shirts[i % shirts.length], low = pants[i % pants.length], skin = skins[i % skins.length];
  const mesh = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
  const torso = mesh(bodyGeo.torso, top, 0, 1.24, 0, 1.18, 1, 0.62);
  mesh(bodyGeo.hips, low, 0, 0.98, 0, 1.08, 1, 0.66);
  mesh(bodyGeo.neck, skin, 0, 1.53, 0);
  const head = mesh(bodyGeo.head, skin, 0, 1.64, 0.01, 0.92, 1.12, 1);
  mesh(bodyGeo.head, hair, 0, 1.675, -0.012, 0.96, 0.9, 0.98);
  const legs = [-1, 1].map((sd) => mesh(bodyGeo.leg, low, sd * 0.085, 0.96, 0));
  const arms = [-1, 1].map((sd) => { const a = mesh(bodyGeo.arm, top, sd * 0.215, 1.44, 0); a.rotation.z = sd * 0.06; return a; });
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // Passada: pernas e braços em oposição, com o leve sobe e desce do corpo
  g.userData.walk = (phase, amp = 0.45) => {
    const k = Math.sin(phase);
    legs[0].rotation.x = k * amp; legs[1].rotation.x = -k * amp;
    arms[0].rotation.x = -k * amp * 0.7; arms[1].rotation.x = k * amp * 0.7;
    const bob = Math.abs(Math.cos(phase)) * 0.022;
    torso.position.y = 1.24 + bob; head.position.y = 1.64 + bob;
  };
  return g;
}

/* ---------- Modelos glTF (Poly Haven, CC0, reduzidos no Blender: blender/vegetacao.py) ---------- */
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
const modelFiles = new Map();
const loadModel = (name) => { if (!modelFiles.has(name)) modelFiles.set(name, gltfLoader.loadAsync(`assets/models/${name}.glb`)); return modelFiles.get(name); };
// Edifício modelado no Blender (blender/edificios.py): cada material do GLB é trocado pelo material do site
// com o mesmo nome, e a oclusão assada (<nome>-ao.jpg, no UV1) entra como aoMap.
export function loadBuilding(name, mats) {
  const ready = Promise.all([
    loadModel(name), texLoader.loadAsync(`assets/models/${name}-ao.jpg`),
    ...Object.values(mats).map((m) => m.userData.ready).filter(Boolean),
  ]).then(([gltf, ao]) => {
    ao.channel = 1; ao.flipY = false;
    const cache = new Map();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.name, base = mats[key];
      if (!base) return console.warn('[MONÓLITO] material sem par', key);
      if (!o.geometry.attributes.uv1 || base.transparent || base.isMeshBasicMaterial) { o.material = base; return; }
      if (!cache.has(key)) { const m = base.clone(); m.aoMap = ao; m.aoMapIntensity = 1; cache.set(key, m); }
      o.material = cache.get(key);
      o.castShadow = o.receiveShadow = true;
    });
    return gltf.scene;
  });
  pendingLoads.push(ready.catch(() => {}));
  return ready;
}

// Vento compartilhado pelas folhas (o cenário ativo avança o tempo)
export const wind = { value: 0 };
function addWind(mat) {
  if (mat.userData.wind) return;
  mat.userData.wind = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      vec3 wp = (instanceMatrix * vec4(position, 1.0)).xyz;
      float sway = sin(uWind * 1.6 + wp.x * 0.7 + wp.z * 0.5) * 0.5 + sin(uWind * 3.7 + wp.y * 2.0 + wp.x) * 0.25;
      transformed.xz += vec2(sway, sway * 0.6) * 0.035 * max(position.y, 0.0);
      #endif`);
  };
}
// Espalha cópias de um modelo como InstancedMesh. `variants`: cada malha do arquivo é uma variante
// (cada item usa uma, pela ordem); senão o modelo inteiro (todas as malhas) vai em cada item.
// Itens: { x, z, y = 0, s = 1, r = 0, v = índice }.
export function scatter(parent, name, items, { variants = false, shadow = true, tint, windy = false } = {}) {
  const group = new THREE.Group();
  parent.add(group);
  const ready = loadModel(name).then((gltf) => {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const box3 = new THREE.Box3(), off = new THREE.Matrix4(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    if (!variants) box3.setFromObject(root);
    meshes.forEach((mesh, k) => {
      const mine = variants ? items.filter((it, i) => (it.v ?? i) % meshes.length === k) : items;
      if (!mine.length) return;
      if (variants) box3.setFromObject(mesh);
      // Assenta o modelo na origem: centro em x/z, base em y = 0
      off.makeTranslation(-(box3.min.x + box3.max.x) / 2, -box3.min.y, -(box3.min.z + box3.max.z) / 2).multiply(mesh.matrixWorld);
      const mat = tint ? mesh.material.clone() : mesh.material;
      if (tint) mat.color.multiply(new THREE.Color(tint));
      if (windy && /leaves|leaf/i.test(mat.name)) addWind(mat);
      const im = new THREE.InstancedMesh(mesh.geometry, mat, mine.length);
      mine.forEach((it, i) => {
        m.compose(p.set(it.x, it.y ?? 0, it.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it.r ?? 0), sc.setScalar(it.s ?? 1)).multiply(off);
        im.setMatrixAt(i, m);
      });
      im.castShadow = shadow; im.receiveShadow = true;
      group.add(im);
    });
  }).catch((err) => console.warn('[MONÓLITO] modelo', name, err));
  pendingLoads.push(ready);
  return group;
}

/* ---------- Partículas soltas no ar (poeira, vagalumes, areia ao vento) ---------- */
export function floaters({ count, area, y = [0, 4], color, size, opacity = 0.7, tex }) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() - 0.5) * area; p[i * 3 + 1] = y[0] + Math.random() * (y[1] - y[0]); p[i * 3 + 2] = (Math.random() - 0.5) * area;
    seed[i] = Math.random() * 100;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, color, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.userData.seed = seed;
  pts.frustumCulled = false;
  return pts;
}
