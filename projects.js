// Quatro projetos em escala real, cada um no seu lugar, na sua hora e com vida própria.
import * as THREE from 'three';
import { sandNormal, radialTexture, terrainNoise } from './textures.js';
import { makeSky, envFromSky, loadHDR, envIntensity, boardFormed, windowsTexture, waterMaterial, box, person, tree, floaters, smooth, lerp, clamp } from './kit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const dotTex = radialTexture();

/* Câmera de cada projeto: trilho por quadros-chave + órbita por arraste + paralaxe do cursor. */
function rig(keys) {
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 1500);
  const us = keys.map((k) => k.u);
  const pc = new THREE.CatmullRomCurve3(keys.map((k) => V(...k.pos)), false, 'centripetal');
  const lc = new THREE.CatmullRomCurve3(keys.map((k) => V(...k.look)), false, 'centripetal');
  const P = new THREE.Vector3(), L = new THREE.Vector3(), off = new THREE.Vector3();
  let yaw = 0, yawV = 0, dragging = false;
  const toU = (u) => {
    let i = 0;
    while (i < us.length - 2 && u > us[i + 1]) i++;
    return (i + clamp((u - us[i]) / (us[i + 1] - us[i]))) / (us.length - 1);
  };
  return {
    camera,
    update(u, s) {
      const k = toU(u);
      pc.getPoint(k, P); lc.getPoint(k, L);
      if (!dragging) { yawV += (-yaw * 0.01 - yawV * 0.08) * s.n; yaw += yawV * s.n; }
      off.subVectors(P, L).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      const dist = off.length();
      camera.position.copy(L).add(off);
      camera.position.x += s.mx * dist * 0.025;
      camera.position.y -= s.my * dist * 0.012;
      camera.lookAt(L);
    },
    drag(dx) { dragging = true; yawV = dx * 0.004; yaw = clamp(yaw + yawV, -1.1, 1.1); },
    release() { dragging = false; },
  };
}

// HDRI do cenário: ilumina por imagem e, quando `sky` é passado, vira o fundo (com a névoa na cor do horizonte).
function hdri(renderer, scene, name, { mobile, sunDir, sky, bg = 1, env = 1, fog = 1 }) {
  loadHDR(renderer, name, { mobile, sunDir, background: !!sky }).then(({ env: e, background, horizon }) => {
    scene.environment?.dispose();
    scene.environment = e;
    envIntensity(scene, env);
    if (background) {
      scene.background = background; scene.backgroundIntensity = bg; sky.visible = false;
      // A névoa puxa para a cor do horizonte do HDRI (fog = quanto puxa)
      scene.fog.color.lerp(horizon.multiplyScalar(bg), fog);
    }
  }).catch((err) => console.warn('[MONÓLITO] HDRI', name, err));
}

function sunLight(scene, dir, color, intensity, size, mobile) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.copy(dir).normalize().multiplyScalar(80);
  l.castShadow = true;
  l.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
  Object.assign(l.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 220 });
  l.shadow.bias = -0.0004; l.shadow.normalBias = 0.04;
  scene.add(l, l.target);
  return l;
}

function crossFront(parent, mat, W, H, T, z, slit, cy, arm) {
  // Parede frontal montada em peças ao redor de uma cruz vazada
  const L = W / 2, y0 = H * 0.13, y1 = H * 0.88, s = slit / 2;
  const piece = (x0, x1, a, b) => box(parent, x1 - x0, b - a, T, mat, (x0 + x1) / 2, (a + b) / 2, z);
  piece(-L, L, 0, y0); piece(-L, L, y1, H);
  piece(-L, -arm, y0, y1); piece(arm, L, y0, y1);
  piece(-arm, -s, y0, cy - s); piece(-arm, -s, cy + s, y1);
  piece(s, arm, y0, cy - s); piece(s, arm, cy + s, y1);
}

function archGeo(w, h, t, depth) {
  const R = w / 2, r = R - t, sh = new THREE.Shape();
  sh.moveTo(-R, 0); sh.lineTo(-R, h); sh.absarc(0, h, R, Math.PI, 0, true); sh.lineTo(R, 0);
  sh.lineTo(r, 0); sh.lineTo(r, h); sh.absarc(0, h, r, 0, Math.PI, false); sh.lineTo(-r, 0); sh.lineTo(-R, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 48 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/* =====================================================================
   01 · CASA DUNA — Atacama, fim de tarde
   ===================================================================== */
export function casaDuna(renderer, { mobile }) {
  const scene = new THREE.Scene();
  const sunDir = V(-0.62, 0.16, -0.55);
  const sky = makeSky({ top: '#56647d', horizon: '#f1b07a', bottom: '#d9b08a', sun: sunDir, sunColor: '#ffc68c', glow: 0.45 });
  scene.add(sky);
  scene.environment = envFromSky(renderer, sky);
  scene.fog = new THREE.FogExp2('#e5b68c', 0.0075);
  sunLight(scene, sunDir, '#ffc995', 3.3, 28, mobile);
  scene.add(new THREE.HemisphereLight('#a6b3c9', '#c79d75', 0.65));

  // Dunas suaves
  const gg = new THREE.PlaneGeometry(500, 500, 140, 140);
  gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const n = terrainNoise(x * 0.012 + 5, z * 0.016, 4);
    gp.setY(i, (Math.pow(1 - Math.abs(n * 2 - 1), 2) * 9 + n * 2) * smooth(26, 90, Math.hypot(x, z)) - 0.02);
  }
  gg.computeVertexNormals();
  const sn = sandNormal(256); sn.repeat.set(160, 160);
  const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: '#c9a37d', roughness: 0.95, normalMap: sn, normalScale: new THREE.Vector2(0.3, 0.3) }));
  ground.receiveShadow = true;
  scene.add(ground);

  const conc = boardFormed(206);
  conc.repeat.set(2, 1);
  const M = {
    concrete: new THREE.MeshStandardMaterial({ map: conc, roughness: 0.88 }),
    deck: new THREE.MeshStandardMaterial({ color: '#d8ccb9', roughness: 0.8 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#3c3026', roughness: 0.35, metalness: 0.75 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#9fb0b0', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, envMapIntensity: 1.4 }),
    warm: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffbf80').multiplyScalar(3) }),
    sofa: new THREE.MeshStandardMaterial({ color: '#b9a58c', roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6 }),
    rock: new THREE.MeshStandardMaterial({ color: '#6d5a48', roughness: 0.95, flatShading: true }),
  };
  const water = waterMaterial('#3f6f7c', 3);
  const h = new THREE.Group();
  scene.add(h);

  box(h, 30, 0.5, 16, M.deck, 0, 0.25, 0);
  const pool = box(h, 13, 0.06, 4.2, water, -5, 0.52, 5.2, { cast: false });
  pool.receiveShadow = true;
  box(h, 12, 3.2, 8, M.concrete, 2, 2.1, -2.5);                 // volume térreo
  box(h, 19, 0.3, 9.2, M.concrete, 4, 3.85, -2.4);              // laje do vidro
  box(h, 14, 2.9, 7.6, M.glass, 4, 5.45, -2.4, { cast: false }); // faixa de vidro
  for (let x = -2.6; x <= 10.6; x += 1.45) {                    // montantes de bronze
    box(h, 0.07, 2.9, 0.07, M.bronze, x, 5.45, 1.42);
    box(h, 0.07, 2.9, 0.07, M.bronze, x, 5.45, -6.22);
  }
  // Interior: luz quente, sofá, mesa e luminária
  box(h, 12, 0.04, 5.8, M.warm, 4, 6.85, -2.4, { cast: false });
  box(h, 3.4, 0.75, 1.1, M.sofa, 1.2, 4.38, -0.6);
  box(h, 2.2, 0.08, 1.1, M.dark, 6, 4.75, -1.6);
  box(h, 0.08, 0.72, 0.08, M.dark, 5.1, 4.38, -1.6); box(h, 0.08, 0.72, 0.08, M.dark, 6.9, 4.38, -1.6);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 12), M.warm);
  lamp.position.set(8.8, 5.2, -0.4); h.add(lamp);
  const inner = new THREE.PointLight('#ffb978', 22, 16, 1.6);
  inner.position.set(4, 6, -2); h.add(inner);
  // Volume superior em balanço com rasgo de luz
  box(h, 21, 3.2, 8.6, M.concrete, 7, 8.6, -2.6);
  box(h, 15, 0.42, 0.06, M.warm, 8, 8.7, 1.72, { cast: false });
  box(h, 21.4, 0.22, 9, M.bronze, 7, 10.3, -2.6);
  // Escada lateral
  for (let i = 0; i < 9; i++) box(h, 1.6, 0.18, 0.42, M.concrete, -4.8, 0.6 + i * 0.37, -6.6 + i * 0.42);
  // Pedras e um pequeno grupo de pessoas
  [[-14, 6, 1.4], [-11, 9, 0.8], [13, 7, 1.1], [16, -9, 1.6]].forEach(([x, z, s]) => {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), M.rock);
    r.position.set(x, s * 0.4, z); r.rotation.set(Math.random(), Math.random(), 0); r.castShadow = true; scene.add(r);
  });
  const standing = person(1); standing.position.set(0.5, 4, 0.6); standing.rotation.y = 0.3; h.add(standing);
  const walker = person(2); h.add(walker);
  const sitter = person(3); sitter.position.set(-9.6, 0.5, 3.1); sitter.rotation.y = Math.PI; sitter.scale.y = 0.62; h.add(sitter);

  const wind = floaters({ count: mobile ? 220 : 520, area: 70, y: [0, 3], color: '#ffe0bd', size: 0.07, opacity: 0.45, tex: dotTex });
  scene.add(wind);

  hdri(renderer, scene, 'quarry_01', { mobile, sunDir, sky, bg: 0.7, env: 0.75, fog: 0.4 });

  const cam = rig([
    { u: 0, pos: [-31, 1.5, 33], look: [2, 4, 0] },
    { u: 0.35, pos: [-13, 2.2, 27], look: [3, 4.8, -2] },
    { u: 0.7, pos: [17, 3.4, 25], look: [6, 6, -2] },
    { u: 1, pos: [31, 7, 13], look: [6, 6, -2] },
  ]);

  function update(u, s) {
    cam.update(u, s);
    sky.material.uniforms.uTime.value = s.t;
    water.userData.flow(s.t);
    const span = 17, ph = (s.t * 0.09) % 2;
    const d = ph < 1 ? ph : 2 - ph; // vai e volta pelo deck
    walker.position.set(-12 + d * span, 0.5, 6.8 + Math.sin(s.t * 0.2) * 0.2);
    walker.rotation.y = ph < 1 ? Math.PI / 2 : -Math.PI / 2;
    walker.userData.walk(s.t * 5.2);
    const a = wind.geometry.attributes.position.array;
    if (!s.paused) for (let i = 0; i < a.length; i += 3) { a[i] += 0.05 * s.n; a[i + 1] += Math.sin(s.t + i) * 0.002; if (a[i] > 35) a[i] = -35; }
    wind.geometry.attributes.position.needsUpdate = true;
  }
  return { scene, camera: cam.camera, update, drag: cam.drag, release: cam.release, bloom: { strength: 0.45, radius: 0.42, threshold: 1.0 } };
}

/* =====================================================================
   02 · CAPELA FENDA — Serra da Canastra, hora azul
   ===================================================================== */
export function capelaFenda(renderer, { mobile }) {
  const scene = new THREE.Scene();
  const sunDir = V(0.55, -0.015, -0.8);
  const sky = makeSky({ top: '#141a2a', horizon: '#c07f62', bottom: '#2c2f30', sun: sunDir, sunColor: '#ff9a62', sunSize: 3000, glow: 0.55, stars: 0.75 });
  scene.add(sky);
  scene.environment = envFromSky(renderer, sky);
  scene.fog = new THREE.FogExp2('#3c3f4b', 0.014);
  scene.add(new THREE.HemisphereLight('#6d80ad', '#2a2920', 0.55));
  const rim = new THREE.DirectionalLight('#9fb2e0', 0.55);
  rim.position.set(20, 25, -30); scene.add(rim);

  const gg = new THREE.PlaneGeometry(300, 300, 120, 120);
  gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    gp.setY(i, terrainNoise(x * 0.02, z * 0.02, 3) * 6 * smooth(18, 70, Math.hypot(x, z)) - 0.02);
  }
  gg.computeVertexNormals();
  const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: '#3e4a31', roughness: 0.95 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Capim que balança: lâminas instanciadas com vento no vertex shader
  const bladeGeo = new THREE.PlaneGeometry(0.05, 0.7, 1, 3);
  bladeGeo.translate(0, 0.35, 0);
  const bp = bladeGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setX(i, bp.getX(i) * (1 - bp.getY(i) / 0.75));
  const grassMat = new THREE.MeshStandardMaterial({ color: '#7d8a52', roughness: 0.9, side: THREE.DoubleSide });
  const wind = { value: 0 };
  grassMat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
      float bend = (sin(uWind * 1.7 + ip.x * 0.35 + ip.z * 0.2) * 0.5 + 0.5) * 0.22 + 0.05;
      transformed.x += bend * position.y * position.y;`);
  };
  const N = mobile ? 7000 : 22000;
  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, N);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  for (let i = 0, k = 0; k < N && i < N * 3; i++) {
    const r = 5.5 + Math.sqrt(Math.random()) * 34, a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 1.4 && z > 3) continue; // caminho livre
    e.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
    q.setFromEuler(e);
    sc.set(1, 0.6 + Math.random() * 0.9, 1);
    ps.set(x, 0, z);
    grass.setMatrixAt(k++, mtx.compose(ps, q, sc));
  }
  grass.receiveShadow = true;
  scene.add(grass);

  // Capela: cubo de concreto com cruz vazada; uma luz interna projeta a cruz no capim
  const conc = boardFormed(188);
  conc.repeat.set(2, 2);
  const cm = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9 });
  const c = new THREE.Group();
  scene.add(c);
  const W = 8, H = 9, T = 0.5;
  box(c, W, H, T, cm, 0, H / 2, -W / 2 + T / 2);
  box(c, T, H, W, cm, -W / 2 + T / 2, H / 2, 0);
  box(c, T, H, W, cm, W / 2 - T / 2, H / 2, 0);
  box(c, W, T, W, cm, 0, H - T / 2, 0);
  box(c, W, 0.2, W, cm, 0, 0.1, 0);
  crossFront(c, cm, W, H, T, W / 2 - T / 2, 0.42, H * 0.66, 2.2);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb46e').multiplyScalar(4) });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.2, H - 1.2), glowMat);
  back.position.set(0, H / 2, -W / 2 + T + 0.05); c.add(back);
  const spot = new THREE.SpotLight('#ffb36d', 900, 60, 0.55, 0.35, 1.6);
  spot.position.set(0, H * 0.62, -W / 2 + T + 0.6);
  spot.target.position.set(0, 0, 22);
  spot.castShadow = true;
  spot.shadow.mapSize.setScalar(mobile ? 512 : 1024);
  spot.shadow.bias = -0.0005;
  c.add(spot, spot.target);

  // Caminho de pedras, banco, árvore e uma pessoa chegando
  const stone = new THREE.MeshStandardMaterial({ color: '#8d8578', roughness: 0.9 });
  for (let i = 0; i < 16; i++) {
    const z = 5.5 + i * 1.55, x = Math.sin(i * 0.5) * 0.35;
    const st = box(scene, 1.2, 0.08, 0.8, stone, x, 0.04, z);
    st.rotation.y = (Math.random() - 0.5) * 0.2;
  }
  box(scene, 2.6, 0.45, 0.6, cm, -5.5, 0.23, 10);
  const t1 = tree({ h: 7, r: 2.6, color: '#2f3a28' }); t1.position.set(-13, 0, -4); scene.add(t1);
  const t2 = tree({ h: 5, r: 2, color: '#343f2b' }); t2.position.set(15, 0, -9); scene.add(t2);
  const visitor = person(0); scene.add(visitor);

  const flies = floaters({ count: mobile ? 70 : 160, area: 40, y: [0.3, 3], color: '#ffd98a', size: 0.16, opacity: 0.9, tex: dotTex });
  scene.add(flies);

  hdri(renderer, scene, 'aarfontein_dawn_2', { mobile, sunDir, env: 0.06 });

  const cam = rig([
    { u: 0, pos: [0.6, 1.6, 38], look: [0, 3.4, 0] },
    { u: 0.4, pos: [-7, 1.3, 27], look: [0, 2.6, 5] },
    { u: 0.72, pos: [-21, 4, 17], look: [0, 4, 0] },
    { u: 1, pos: [-25, 8, -2], look: [0, 4.4, 0] },
  ]);

  function update(u, s) {
    cam.update(u, s);
    sky.material.uniforms.uTime.value = s.t;
    if (!s.paused) wind.value = s.t;
    const ph = (s.t * 0.035) % 1;
    visitor.position.set(Math.sin((1 - ph) * 8) * 0.3, 0.05, lerp(30, 6.5, ph));
    visitor.rotation.y = Math.PI;
    visitor.userData.walk(s.t * 4.4, 0.35);
    flies.material.opacity = 0.55 + Math.sin(s.t * 3.1) * 0.25 + Math.sin(s.t * 7.3) * 0.15;
    if (!s.paused) {
      const a = flies.geometry.attributes.position.array, sd = flies.userData.seed;
      for (let i = 0; i < sd.length; i++) {
        a[i * 3] += Math.sin(s.t * 0.7 + sd[i]) * 0.01 * s.n;
        a[i * 3 + 1] += Math.cos(s.t * 0.9 + sd[i] * 2) * 0.006 * s.n;
        a[i * 3 + 2] += Math.cos(s.t * 0.5 + sd[i]) * 0.01 * s.n;
      }
      flies.geometry.attributes.position.needsUpdate = true;
    }
    spot.intensity = 900 * (0.94 + Math.sin(s.t * 1.3) * 0.03 + Math.sin(s.t * 5.1) * 0.02);
    t1.userData.sway(s.t); t2.userData.sway(s.t);
  }
  return { scene, camera: cam.camera, update, drag: cam.drag, release: cam.release, bloom: { strength: 0.75, radius: 0.5, threshold: 0.9 } };
}

/* =====================================================================
   03 · PAVILHÃO ARCO — Lisboa, beira-rio de manhã
   ===================================================================== */
export function pavilhaoArco(renderer, { mobile }) {
  const scene = new THREE.Scene();
  const sunDir = V(0.55, 0.55, -0.35); // elevação de ~40°, a mesma do sol do HDRI
  const sky = makeSky({ top: '#7aa3cc', horizon: '#ebe6dd', bottom: '#cfd5d6', sun: sunDir, sunColor: '#fff2dc', sunSize: 1600, glow: 0.22 });
  scene.add(sky);
  scene.environment = envFromSky(renderer, sky);
  scene.fog = new THREE.FogExp2('#dfe2e2', 0.006);
  sunLight(scene, sunDir, '#fff0dc', 3.1, 40, mobile);
  scene.add(new THREE.HemisphereLight('#cfe0f2', '#d9cfbf', 0.75));

  // Praça de travertino com juntas
  const tiles = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
      const v = 226 + (Math.random() - 0.5) * 14;
      g.fillStyle = `rgb(${v},${v - 6},${v - 18})`; g.fillRect(x * 128, y * 64, 128, 64);
    }
    g.strokeStyle = 'rgba(120,105,85,.35)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); }
    for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 256); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(30, 30);
    return t;
  })();
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.75 }));
  plaza.rotation.x = -Math.PI / 2; plaza.receiveShadow = true; scene.add(plaza);

  const pool = waterMaterial('#6d8893', 4);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(16, 52), pool);
  water.rotation.x = -Math.PI / 2; water.position.y = 0.03; water.receiveShadow = true; scene.add(water);
  const river = waterMaterial('#5d7d8c', 40);
  const tejo = new THREE.Mesh(new THREE.PlaneGeometry(900, 500), river);
  tejo.rotation.x = -Math.PI / 2; tejo.position.set(0, -0.6, -310); scene.add(tejo);
  const edge = new THREE.MeshStandardMaterial({ color: '#d9cfbe', roughness: 0.7 });
  box(scene, 120, 0.7, 1.2, edge, 0, -0.25, -60.6);

  // Sete arcos em escala real (7 m de vão, 9 m de altura)
  const trav = new THREE.MeshStandardMaterial({ color: '#e9dfcd', roughness: 0.62 });
  const ag = archGeo(7.4, 5.6, 0.95, 1.3);
  for (let i = 0; i < 7; i++) {
    const a = new THREE.Mesh(ag, trav);
    a.position.set(0, 0, 15 - i * 5);
    a.castShadow = a.receiveShadow = true;
    scene.add(a);
  }
  // Bancos e árvores ao redor
  for (let i = 0; i < 4; i++) box(scene, 3.2, 0.48, 0.7, edge, (i % 2 ? 1 : -1) * 11, 0.24, 12 - i * 9);
  const trees = [[-17, 18], [-19, 2], [-16, -14], [17, 16], [19, -2], [16, -18]].map(([x, z]) => {
    const t = tree({ h: 7.5, r: 2.6, color: '#6f7d4b' }); t.position.set(x, 0, z); scene.add(t); return t;
  });

  // Pessoas atravessando os arcos em ritmos diferentes
  const walkers = Array.from({ length: mobile ? 5 : 9 }, (_, i) => {
    const p = person(i); scene.add(p);
    p.userData.lane = (i % 2 ? 1 : -1) * (1.9 + (i % 3) * 0.55);
    p.userData.speed = 0.012 + Math.random() * 0.01;
    p.userData.offset = Math.random();
    p.userData.dir = i % 2 ? 1 : -1;
    return p;
  });

  // Gaivotas: dois triângulos que batem asas, voando em círculo
  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.7, 0.15, 0.2, 0, 0, 0.35, 0, 0, 0, 0.7, 0.15, 0.2, 0, 0, 0.35], 3));
  birdGeo.computeVertexNormals();
  const birdMat = new THREE.MeshBasicMaterial({ color: '#4f5458', side: THREE.DoubleSide });
  const birds = Array.from({ length: 11 }, (_, i) => { const b = new THREE.Mesh(birdGeo, birdMat); b.userData.k = i; scene.add(b); return b; });

  hdri(renderer, scene, 'qwantani_mid_morning_puresky', { mobile, sunDir, sky, bg: 1.6, env: 1.0 });

  const cam = rig([
    { u: 0, pos: [15, 1.1, 34], look: [0, 3.4, 4] },
    { u: 0.38, pos: [0.4, 1.7, 24], look: [0, 3, 0] },
    { u: 0.72, pos: [0, 1.7, -4], look: [0, 3.2, -22] },
    { u: 1, pos: [-9, 2.2, -28], look: [0, 3.4, -4] },
  ]);

  function update(u, s) {
    cam.update(u, s);
    pool.userData.flow(s.t); river.userData.flow(s.t * 2);
    walkers.forEach((p) => {
      const d = p.userData;
      const ph = ((s.t * d.speed + d.offset) % 1);
      const z = d.dir > 0 ? lerp(26, -26, ph) : lerp(-26, 26, ph);
      p.position.set(d.lane, 0.03, z);
      p.rotation.y = d.dir > 0 ? Math.PI : 0;
      p.userData.walk(s.t * 5 + d.offset * 10);
    });
    birds.forEach((b) => {
      const k = b.userData.k, a = s.t * 0.15 + k * 0.25;
      b.position.set(Math.cos(a) * (28 + k), 16 + Math.sin(a * 2 + k) * 2, -10 + Math.sin(a) * (20 + k));
      b.rotation.y = -a;
      b.scale.y = 0.4 + Math.abs(Math.sin(s.t * 6 + k)) * 1.2;
    });
    trees.forEach((t) => t.userData.sway(s.t, 0.6));
  }
  return { scene, camera: cam.camera, update, drag: cam.drag, release: cam.release, bloom: { strength: 0.3, radius: 0.4, threshold: 1.25 } };
}

/* =====================================================================
   04 · TORRE ESTRATO — São Paulo, noite
   ===================================================================== */
export function torreEstrato(renderer, { mobile }) {
  const scene = new THREE.Scene();
  const sky = makeSky({ top: '#05070d', horizon: '#3a2a35', bottom: '#14131a', sun: V(0, -1, 0), sunSize: 10, glow: 0, stars: 0.4 });
  scene.add(sky);
  scene.environment = envFromSky(renderer, sky);
  scene.fog = new THREE.FogExp2('#1d1a24', 0.0045);
  scene.add(new THREE.HemisphereLight('#5a5a7e', '#1a1814', 0.4));
  const moon = new THREE.DirectionalLight('#9fb0e0', 0.5);
  moon.position.set(-60, 120, 40); scene.add(moon);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: '#16171b', roughness: 0.32, metalness: 0.2 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  // Torre: lajes giradas, vidro com andares acesos, núcleo de bronze e coroa
  const F = mobile ? 26 : 32, FH = 3.6;
  const tower = new THREE.Group();
  scene.add(tower);
  const slabMat = new THREE.MeshStandardMaterial({ color: '#8b857b', roughness: 0.6 });
  // Montantes verticais: o andar aceso vira uma fileira de janelas, não um bloco de luz
  const mull = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 32;
    const g = c.getContext('2d');
    for (let x = 0; x < 64; x++) {
      const on = Math.random() < 0.78;
      g.fillStyle = on ? `rgba(255,${200 + Math.random() * 40},${140 + Math.random() * 40},1)` : '#1a1c22';
      g.fillRect(x * 4, 2, 3, 28);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1);
    return t;
  })();
  const slabGeo = new THREE.BoxGeometry(24, 0.55, 24);
  const glassGeo = new THREE.BoxGeometry(19, FH - 0.6, 19);
  const floors = [];
  for (let i = 0; i < F; i++) {
    const rot = i * 0.045;
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.y = i * FH; slab.rotation.y = rot; tower.add(slab);
    const m = new THREE.MeshStandardMaterial({ color: '#141820', roughness: 0.15, metalness: 0.6, emissive: '#ffffff', emissiveMap: mull, emissiveIntensity: 0 });
    const g = new THREE.Mesh(glassGeo, m);
    g.position.y = i * FH + FH / 2; g.rotation.y = rot; tower.add(g);
    floors.push({ m, phase: Math.random() * 100, base: Math.random() < 0.7 ? 0.35 + Math.random() * 0.6 : 0.03 });
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, F * FH + 6, 32), new THREE.MeshStandardMaterial({ color: '#5a4636', metalness: 0.7, roughness: 0.35 }));
  core.position.y = (F * FH) / 2; tower.add(core);
  const beacons = [[-11, 11], [11, -11]].map(([x, z]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b2e').multiplyScalar(5) }));
    b.position.set(x, F * FH + 1, z); tower.add(b); return b;
  });

  // Cidade: blocos instanciados com janelas acesas
  const wt = windowsTexture(8, 20, 0.4);
  const cityMat = new THREE.MeshStandardMaterial({ color: '#15171d', roughness: 0.7, emissive: '#ffffff', emissiveMap: wt, emissiveIntensity: 0.85, map: wt });
  const NB = mobile ? 110 : 220;
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cityMat, NB);
  const mx = new THREE.Matrix4();
  for (let i = 0, k = 0; k < NB && i < 2000; i++) {
    const x = (Math.random() - 0.5) * 520, z = (Math.random() - 0.5) * 520;
    if (Math.hypot(x, z) < 45 || Math.abs(x % 60) < 9 || Math.abs(z % 60) < 9) continue; // ruas
    const ang = Math.atan2(z, x) * 180 / Math.PI;
    const view = ang > 25 && ang < 130 && Math.hypot(x, z) < 240; // linha de visão da câmera: só prédios baixos
    const w = 12 + Math.random() * 16, hgt = view ? 5 + Math.random() * 9 : 14 + Math.pow(Math.random(), 2) * 85;
    mx.compose(V(x, hgt / 2, z), new THREE.Quaternion(), V(w, hgt, w * (0.7 + Math.random() * 0.6)));
    city.setMatrixAt(k++, mx);
  }
  scene.add(city);

  // Trânsito: faróis brancos e lanternas vermelhas em faixas
  const NC = mobile ? 70 : 160;
  const cars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.25, 3.2), new THREE.MeshBasicMaterial({ color: '#ffffff' }), NC);
  const carData = Array.from({ length: NC }, (_, i) => ({
    axis: i % 2, lane: (Math.floor(Math.random() * 9) - 4) * 60 + (i % 4 < 2 ? -2 : 2), dir: i % 4 < 2 ? 1 : -1, off: Math.random() * 520, speed: 0.4 + Math.random() * 0.5,
  }));
  carData.forEach((c, i) => cars.setColorAt(i, new THREE.Color(c.dir > 0 ? '#fff1d8' : '#ff3324').multiplyScalar(2.2)));
  scene.add(cars);
  const street = new THREE.PointLight('#ffb070', 400, 90, 1.6);
  street.position.set(0, 6, 40); scene.add(street);

  hdri(renderer, scene, 'modern_buildings_night', { mobile, env: 0.02 });

  const cam = rig([
    { u: 0, pos: [62, 3, 128], look: [0, 42, 0] },
    { u: 0.38, pos: [104, 48, 96], look: [0, 58, 0] },
    { u: 0.72, pos: [52, 122, 112], look: [0, 72, 0] },
    { u: 1, pos: [-80, 210, 150], look: [0, 48, 0] },
  ]);
  const q0 = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), yq = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI / 2);

  function update(u, s) {
    cam.update(u, s);
    sky.material.uniforms.uTime.value = s.t;
    floors.forEach((f) => { f.m.emissiveIntensity = f.base * (0.85 + 0.15 * Math.sin(s.t * 0.4 + f.phase)) * (Math.sin(s.t * 0.11 + f.phase) > -0.92 ? 1 : 0.1); });
    beacons.forEach((b) => (b.visible = Math.sin(s.t * 3) > 0.2));
    carData.forEach((c, i) => {
      const d = ((c.off + s.t * 30 * c.speed * c.dir) % 520 + 520) % 520 - 260;
      if (c.axis) ps.set(d, 0.4, c.lane); else ps.set(c.lane, 0.4, d);
      mx.compose(ps, c.axis ? yq : q0, sc);
      cars.setMatrixAt(i, mx);
    });
    cars.instanceMatrix.needsUpdate = true;
  }
  return { scene, camera: cam.camera, update, drag: cam.drag, release: cam.release, bloom: { strength: 0.85, radius: 0.6, threshold: 0.85 } };
}

export const PROJECTS = [casaDuna, capelaFenda, pavilhaoArco, torreEstrato];
