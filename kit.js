// Peças compartilhadas pelos cenários: céu, materiais, água, pessoas, árvores e janelas.
import * as THREE from 'three';
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

// Concreto aparente com marcas de fôrma de tábua (cor + rugosidade em um só mapa).
export function boardFormed(tone = 205) {
  return canvasTex(256, 256, (g, w, h) => {
    for (let y = 0; y < h; y += 16) {
      const b = tone + (Math.random() - 0.5) * 18;
      g.fillStyle = `rgb(${b},${b - 3},${b - 8})`;
      g.fillRect(0, y, w, 16);
      g.fillStyle = 'rgba(0,0,0,.08)';
      g.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 3500; i++) {
      const v = Math.random() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${v},${v},${v},.05)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
    for (let i = 0; i < 40; i++) { // furos de tirante
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.beginPath(); g.arc((i % 8) * 32 + 16, Math.floor(i / 8) * 52 + 26, 1.6, 0, 7); g.fill();
    }
  }, true);
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

/* ---------- Construção ---------- */
export function box(parent, w, h, d, mat, x, y, z, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
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
