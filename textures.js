// Texturas procedurais (sem downloads): ruído periódico, mapas normais e gradientes.
import * as THREE from 'three';

function hash(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Ruído de valor com período P (para texturas que repetem sem emenda).
function noise(x, y, P, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (n) => ((n % P) + P) % P;
  const a = hash(m(xi), m(yi), seed), b = hash(m(xi + 1), m(yi), seed);
  const c = hash(m(xi), m(yi + 1), seed), d = hash(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, P, oct = 4, seed = 1) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f, P * f, seed + i); amp *= 0.5; f *= 2; }
  return s;
}
// Ruído não periódico para terreno.
export function terrainNoise(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f, 1 << 20, 7 + i); amp *= 0.5; f *= 2.03; }
  return s;
}

function heightToNormal(h, size, strength) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function grayTexture(h, size, lo = 0, hi = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = (lo + (hi - lo) * h[i]) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Ondulações de areia esculpidas pelo vento + grão fino.
export function sandNormal(size = 512) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const warp = fbm(u * 4, v * 4, 4, 3, 3) * 2.2;
    const ripple = Math.sin((v * 22 + warp) * Math.PI * 2);
    h[y * size + x] = Math.pow(ripple * 0.5 + 0.5, 1.6) * 0.8 + hash(x, y, 9) * 0.25;
  }
  return heightToNormal(h, size, 2.4);
}

// Pedra: grão, poros e estratos horizontais finos. Devolve mapa normal e de rugosidade.
export function stoneMaps(size = 512) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const base = fbm(u * 8, v * 8, 8, 5, 21);
    const strata = Math.sin((v * 46 + fbm(u * 3, v * 3, 3, 2, 5) * 3) * Math.PI) * 0.06;
    const pore = hash(x, y, 4) > 0.985 ? -0.25 : 0;
    h[y * size + x] = base + strata + pore + hash(x, y, 2) * 0.05;
  }
  const rough = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) rough[i] = Math.min(1, Math.max(0, h[i]));
  return { normal: heightToNormal(h, size, 3.2), rough: grayTexture(rough, size, 0.55, 0.95) };
}

// Concreto claro para as maquetes da galeria: manchas suaves e furos de fôrma.
export function concreteNormal(size = 256) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    h[y * size + x] = fbm(x / size * 6, y / size * 6, 6, 4, 40) * 0.6 + hash(x, y, 11) * 0.08;
  }
  return heightToNormal(h, size, 1.6);
}

export function radialTexture(stops = [[0, 1], [0.25, 0.45], [1, 0]]) {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  stops.forEach(([o, a]) => r.addColorStop(o, `rgba(255,255,255,${a})`));
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

// Feixe de luz vertical com estrias, para os raios que saem da fenda.
export function beamTexture() {
  const w = 128, hgt = 256, c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  const g = c.getContext('2d');
  const img = g.createImageData(w, hgt);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / hgt;
    const edge = Math.pow(Math.sin(u * Math.PI), 2.2);
    const streak = 0.55 + 0.45 * fbm(u * 10, 0.5, 10, 3, 60);
    const fade = Math.pow(1 - v, 1.4);
    const a = edge * streak * fade;
    const i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
