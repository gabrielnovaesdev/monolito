// Peças compartilhadas pelos cenários: céu, materiais, água, pessoas, árvores e janelas.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Water } from 'three/addons/objects/Water.js';
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
const hdrFiles = new Map();
function fetchHDR(name, mobile) {
  const url = `assets/hdri/${name}_${mobile ? '1k' : '2k'}.hdr`;
  if (!hdrFiles.has(url)) hdrFiles.set(url, new RGBELoader().loadAsync(url));
  return hdrFiles.get(url);
}
export async function loadHDR(renderer, name, { mobile, sunDir, clamp = 60, background = false } = {}) {
  const src = await fetchHDR(name, mobile);
  const { width: w, height: h } = src.image, from = THREE.DataUtils.fromHalfFloat, to = THREE.DataUtils.toHalfFloat;
  const data = src.image.data; // RGBA em meio-float, linha 0 = topo
  // Sol do HDRI: pixel mais brilhante na metade de cima
  let best = 0, bi = 0;
  for (let i = 0; i < (w * h) / 2; i++) { const l = from(data[i * 4]) * 0.21 + from(data[i * 4 + 1]) * 0.72 + from(data[i * 4 + 2]) * 0.07; if (l > best) { best = l; bi = i; } }
  let shift = 0;
  if (sunDir) {
    const azH = (((bi % w) + 0.5) / w - 0.5) * Math.PI * 2, azT = Math.atan2(sunDir.z, sunDir.x);
    shift = Math.round(((azT - azH) / (Math.PI * 2)) * w);
  }
  const rot = new Uint16Array(data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = (y * w + x) * 4, b = (y * w + ((((x + shift) % w) + w) % w)) * 4;
    rot[b] = data[a]; rot[b + 1] = data[a + 1]; rot[b + 2] = data[a + 2]; rot[b + 3] = data[a + 3];
  }
  // Cor do céu logo acima do horizonte (para a névoa casar com o fundo)
  const hz = new THREE.Color(0, 0, 0); let n = 0;
  for (let y = Math.floor(h * 0.466); y < h / 2; y++) for (let x = 0; x < w; x += 4) { const a = (y * w + x) * 4; hz.r += from(rot[a]); hz.g += from(rot[a + 1]); hz.b += from(rot[a + 2]); n++; }
  hz.multiplyScalar(1 / n);
  const make = (arr) => {
    const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    t.colorSpace = THREE.LinearSRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping;
    t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = true; t.needsUpdate = true;
    return t;
  };
  // Ambiente: pico do sol limitado a `clamp` × o horizonte
  const lim = Math.max(hz.r, hz.g, hz.b) * clamp, cl = rot.slice();
  for (let i = 0; i < cl.length; i += 4) {
    const m = Math.max(from(cl[i]), from(cl[i + 1]), from(cl[i + 2]));
    if (m > lim) { const k = lim / m; cl[i] = to(from(cl[i]) * k); cl[i + 1] = to(from(cl[i + 1]) * k); cl[i + 2] = to(from(cl[i + 2]) * k); }
  }
  const envSrc = make(cl), pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(envSrc).texture;
  pm.dispose(); envSrc.dispose();
  return { env, background: background ? make(rot) : null, horizon: hz };
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
export function pbr(name, { size = 2, normalScale = 1, aoIntensity = 1, normal = true, ...params } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, ...params });
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

// Grade de janelas acesas aleatoriamente (para a cidade à noite).
export function windowsTexture(cols = 8, rows = 16, lit = 0.35) {
  return canvasTex(cols * 16, rows * 16, (g, w, h) => {
    g.fillStyle = '#0d0f14'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const on = Math.random() < lit;
      const warm = Math.random() < 0.7;
      g.fillStyle = on ? (warm ? `rgba(255,${190 + Math.random() * 40},${120 + Math.random() * 40},1)` : 'rgba(190,215,255,1)') : 'rgba(40,46,58,1)';
      g.fillRect(x * 16 + 3, y * 16 + 4, 10, 9);
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

/* ---------- Pessoas (silhuetas estilizadas, escala real ~1,75 m) ---------- */
const personMats = ['#2b2723', '#3b342d', '#7a6a58', '#d8cfc2', '#4a4f57'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
export function person(i = 0) {
  const g = new THREE.Group();
  const m = personMats[i % personMats.length];
  const skin = new THREE.MeshStandardMaterial({ color: '#8a6a52', roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.62, 4, 10), m);
  body.position.y = 1.12; body.scale.z = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skin);
  head.position.y = 1.62;
  const legs = [-1, 1].map((s) => {
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.68, 3, 8), personMats[0]);
    l.geometry.translate(0, -0.42, 0);
    l.position.set(s * 0.09, 0.84, 0);
    g.add(l);
    return l;
  });
  g.add(body, head);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // Passada: as pernas balançam conforme a distância percorrida
  g.userData.walk = (phase, amp = 0.45) => { legs[0].rotation.x = Math.sin(phase) * amp; legs[1].rotation.x = -Math.sin(phase) * amp; body.position.y = 1.12 + Math.abs(Math.cos(phase)) * 0.025; };
  return g;
}

/* ---------- Árvores ---------- */
export function tree({ h = 6, r = 2.2, color = '#5f6b45', trunk = '#4a3a2c' } = {}) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, h * 0.55, 8), new THREE.MeshStandardMaterial({ color: trunk, roughness: 0.9 }));
  t.position.y = h * 0.275; t.castShadow = true; g.add(t);
  const leaf = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r * (0.5 + Math.random() * 0.35), 1), leaf);
    c.position.set((Math.random() - 0.5) * r, h * 0.62 + Math.random() * r * 0.7, (Math.random() - 0.5) * r);
    c.castShadow = true; g.add(c);
  }
  g.userData.sway = (t, k = 1) => { g.rotation.z = Math.sin(t * 0.9 + g.position.x) * 0.012 * k; g.rotation.x = Math.cos(t * 0.7 + g.position.z) * 0.01 * k; };
  return g;
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
