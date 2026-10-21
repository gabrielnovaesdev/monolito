// Deserto ao entardecer: céu com nuvens, dunas, montanhas no horizonte e o monólito que se abre.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadHDR, envIntensity, pbr, uvScale, takeLoads } from './kit.js';
import { sandNormal, stoneMaps, radialTexture, beamTexture, terrainNoise } from './textures.js';

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 3);
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const GLSL_NOISE = /* glsl */`
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

export function createDesert(renderer, { mobile }) {
  const scene = new THREE.Scene();
  const FOG = new THREE.Color('#d9a97e');
  const FOG_DUSK = new THREE.Color('#b9806a');
  const WHITE = new THREE.Color('#f2efea');
  scene.fog = new THREE.FogExp2(FOG.clone(), 0.012);

  /* ---------- Céu ---------- */
  const sunBase = new THREE.Vector3(0.2, 0.085, -0.98).normalize(); // sol logo atrás do monólito
  const sunDir = sunBase.clone();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#38404f') }, uHorizon: { value: new THREE.Color('#f0a768') },
      uTopDusk: { value: new THREE.Color('#2b2a3d') }, uHorizonDusk: { value: new THREE.Color('#e5805c') },
      uBottom: { value: new THREE.Color('#d9a97e') },
      uSun: { value: sunDir }, uTime: { value: 0 }, uWhite: { value: 0 }, uDusk: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uTopDusk, uHorizonDusk, uBottom, uSun;
      uniform float uTime, uWhite, uDusk;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 top = mix(uTop, uTopDusk, uDusk), hor = mix(uHorizon, uHorizonDusk, uDusk);
        vec3 col = mix(hor, top, pow(smoothstep(-0.02, 0.55, h), 0.65));
        col = mix(col, uBottom, smoothstep(0.0, -0.1, h));
        float s = max(dot(d, normalize(uSun)), 0.0);
        // Nuvens finas e alongadas num plano, iluminadas pelo lado do sol
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.06) * 0.55 + vec2(uTime * 0.006, 0.0);
          float n = fbm(uv * vec2(0.7, 2.2));
          float mask = smoothstep(0.35, 0.75, fbm(uv * 0.18 + 4.0)); // grupos de nuvens, não faixas contínuas
          float cl = smoothstep(0.56, 0.9, n) * mask * smoothstep(0.0, 0.14, h) * (1.0 - 0.7 * smoothstep(0.3, 0.75, h));
          vec3 cc = mix(vec3(0.58, 0.47, 0.46), vec3(1.0, 0.8, 0.58), 0.3 + 0.7 * pow(s, 3.0));
          col = mix(col, cc, cl * 0.8);
        }
        col += vec3(1.0, 0.7, 0.42) * (pow(s, 1400.0) * 6.0 + pow(s, 60.0) * 0.45 + pow(s, 8.0) * 0.2 + pow(s, 2.0) * 0.05);
        col = mix(col, vec3(0.9, 0.87, 0.82), uWhite);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 48, 24), skyMat);
  scene.add(sky);

  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(sky.geometry, skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 500).texture;
  pmrem.dispose();

  /* ---------- Luz ---------- */
  const sun = new THREE.DirectionalLight('#ffc08a', 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 120 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#8e97ab', '#b88d68', 0.75);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight('#ffd7b0', 0.42);
  fill.position.set(5, 3, 12);
  scene.add(fill);

  /* ---------- Dunas ---------- */
  const seg = mobile ? 160 : 260;
  const groundGeo = new THREE.PlaneGeometry(300, 300, seg, seg);
  groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const n = terrainNoise(x * 0.016 + 3, z * 0.022, 4);
    const ridge = 1 - Math.abs(n * 2 - 1); // cristas afiadas
    const h = Math.pow(ridge, 2.4) * 5.2 + terrainNoise(x * 0.07, z * 0.07, 3) * 0.7;
    gp.setY(i, h * smooth(9, 48, Math.hypot(x, z * 0.85)) - 0.05);
  }
  groundGeo.computeVertexNormals();
  uvScale(groundGeo, 300);
  const sandN = sandNormal(256);
  sandN.repeat.setScalar(110 / 300);
  // Grão e cor da areia (PBR, chega depois do primeiro quadro) com as ondulações de vento procedurais
  const sandMat = pbr('dense_sand', { size: 1.8, normal: false, color: '#c8a27c', roughness: 1 });
  sandMat.userData.ready.then(() => sandMat.color.set('#efc79f')); // cor lisa até a textura chegar
  sandMat.normalMap = sandN; sandMat.normalScale.set(0.32, 0.32);
  takeLoads(); // o hero não espera pela areia
  const ground = new THREE.Mesh(groundGeo, sandMat);
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---------- Montanhas no horizonte (silhuetas em camadas) ---------- */
  const ranges = [
    { r: 150, h: 9, color: '#c98a64', seed: 2 },
    { r: 230, h: 15, color: '#dca07a', seed: 9 },
  ].map(({ r, h, color, seed }) => {
    const N = 360, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const n = terrainNoise(Math.cos(a) * 3 + seed, Math.sin(a) * 3 + seed, 4);
      const mesa = smooth(0.46, 0.52, n) * 0.7 + n * 0.5; // topos planos de mesa
      const y = -4 + h * mesa;
      pos.push(Math.cos(a) * r, -4, Math.sin(a) * r, Math.cos(a) * r, y, Math.sin(a) * r);
      if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
    m.userData.base = new THREE.Color(color);
    scene.add(m);
    return m;
  });

  /* ---------- Monólito ---------- */
  const W = 1.7, H = 4.4, D = 0.44;
  const stone = stoneMaps(256);
  stone.normal.repeat.set(1, 2.6);
  stone.rough.repeat.set(1, 2.6);
  const stoneMat = new THREE.MeshStandardMaterial({
    color: '#11100e', roughness: 0.9, roughnessMap: stone.rough, metalness: 0.15,
    normalMap: stone.normal, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.6,
  });
  const AMBER = new THREE.Color('#ffb06a');
  const glowMat = (k) => new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(k), toneMapped: true, fog: false });

  const mono = new THREE.Group();
  scene.add(mono);
  const base = new THREE.Mesh(new RoundedBoxGeometry(W + 1.1, 0.3, D + 1.1, 2, 0.04), stoneMat);
  base.position.y = 0.04;
  base.receiveShadow = base.castShadow = true;
  scene.add(base);

  const halfGeo = new RoundedBoxGeometry(W / 2 - 0.004, H, D, 4, 0.03);
  const edgeGeo = new THREE.BoxGeometry(0.018, H * 0.97, D * 0.86);
  const edgeMat = glowMat(3.2);
  const halves = [-1, 1].map((s) => {
    const m = new THREE.Mesh(halfGeo, stoneMat);
    m.position.set(s * W / 4, H / 2 + 0.18, 0);
    m.castShadow = m.receiveShadow = true;
    const edge = new THREE.Mesh(edgeGeo, edgeMat); // borda interna que acende ao abrir
    edge.position.x = -s * (W / 4 - 0.006);
    m.add(edge);
    mono.add(m);
    return m;
  });

  const seamMat = glowMat(2.6);
  seamMat.transparent = true;
  const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.014, H * 0.97), seamMat);
  seam.position.set(0, H / 2 + 0.18, D / 2 + 0.004);
  mono.add(seam);

  const portalMat = new THREE.MeshBasicMaterial({ map: radialTexture([[0, 1], [0.4, 0.85], [1, 0]]), color: new THREE.Color('#ffe2c4').multiplyScalar(1.25), transparent: true, depthWrite: false, fog: false });
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), portalMat);
  portal.position.set(0, H / 2, -11);
  portal.scale.set(W * 2.4, H * 1.35, 1);
  mono.add(portal);

  // Raios de luz em leque, deitados na direção da câmera
  const beamTex = beamTexture();
  const beams = [-0.32, -0.1, 0.12, 0.34].map((ang, i) => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, -0.5, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      map: beamTex, color: '#ffc58f', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    }));
    m.position.set(0, H * (0.42 + i * 0.09), 0);
    m.rotation.set(-Math.PI / 2 + 0.16 + i * 0.03, ang, 0, 'YXZ');
    m.scale.set(1.4 + i * 0.4, 13 + i * 2, 1);
    mono.add(m);
    return m;
  });

  // Corredor: duas paredes longas sobem da areia atrás do monólito, com um fio de luz no chão
  const CORR = 10;
  const wallGeo = new RoundedBoxGeometry(0.5, H, CORR, 3, 0.03);
  const walls = [-1, 1].map((sd) => {
    const w = new THREE.Mesh(wallGeo, stoneMat);
    w.position.set(sd * 1.95, -H, -0.6 - CORR / 2);
    w.castShadow = w.receiveShadow = true;
    scene.add(w);
    return w;
  });
  const lineMat = glowMat(2.4);
  lineMat.transparent = true;
  const floorLine = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.01, CORR), lineMat);
  floorLine.position.set(0, 0.2, -0.6 - CORR / 2);
  scene.add(floorLine);
  const corrFloor = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, CORR), stoneMat);
  corrFloor.position.set(0, 0.04, -0.6 - CORR / 2);
  corrFloor.receiveShadow = true;
  scene.add(corrFloor);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: '#ffb877', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.position.set(0, H / 2, -0.5);
  mono.add(glow);
  const inner = new THREE.PointLight('#ffad6a', 0, 24, 1.3);
  inner.position.set(0, H * 0.55, -0.4);
  mono.add(inner);

  // Monólitos distantes dão escala
  [[-34, -62, 0.7, 0.3], [48, -110, 0.9, -0.5], [-90, -150, 1.2, 0.8]].forEach(([x, z, s, r]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(W * s, H * s, D * s), stoneMat);
    m.position.set(x, (H * s) / 2 - 0.2, z);
    m.rotation.y = r;
    scene.add(m);
  });

  /* ---------- Poeira ---------- */
  const DUST = mobile ? 300 : 800;
  const dustGeo = new THREE.BufferGeometry();
  const dp = new Float32Array(DUST * 3), seeds = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dp[i * 3] = (Math.random() - 0.5) * 30;
    dp[i * 3 + 1] = Math.random() * 7;
    dp[i * 3 + 2] = (Math.random() - 0.5) * 30;
    seeds[i] = Math.random() * 100;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    map: radialTexture(), color: '#ffe3c2', size: 0.055, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(dust);

  /* ---------- Trilhos de câmera ---------- */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const journeyP = [0, 0.14, 0.36, 0.52, 0.8, 1];
  const posCurve = new THREE.CatmullRomCurve3([V(0, 1.45, 11.8), V(0.35, 1.7, 9.0), V(0, 1.9, 5.6), V(0, 2.0, 1.2), V(0, 2.05, -4.8), V(0, 2.1, -8.2)], false, 'centripetal');
  const lookCurve = new THREE.CatmullRomCurve3([V(0, 2.1, 0), V(0, 2.2, 0), V(0, 2.2, -2), V(0, 2.1, -8), V(0, 2.1, -12), V(0, 2.1, -13)], false, 'centripetal');
  const toU = (p) => {
    let i = 0;
    while (i < journeyP.length - 2 && p > journeyP[i + 1]) i++;
    const t = (p - journeyP[i]) / (journeyP[i + 1] - journeyP[i]);
    return (i + Math.min(1, Math.max(0, t))) / (journeyP.length - 1);
  };
  const craneFrom = V(-6, 8.5, 27), craneLook = V(0, 3.2, 0);
  const tmpP = new THREE.Vector3(), tmpL = new THREE.Vector3(), sunTmp = new THREE.Vector3();

  /* ---------- Interação: girar o monólito ---------- */
  let rot = 0, rotV = 0, dragging = false;

  /* ---------- Coreografia da porta: areia que cai, poeira, onda de choque ---------- */
  // Tudo é função do progresso (rolagem), então voltar a rolar desfaz o efeito exatamente.
  const bump = (a, b, x) => (x <= a || x >= b ? 0 : Math.sin(Math.PI * (x - a) / (b - a)));
  const SAND = mobile ? 420 : 1100;
  const sand = [];
  for (let i = 0; i < SAND; i++) {
    const r = Math.random();
    // tipo 0: bordas superiores das metades ao abrir; 1: topo das paredes subindo; 2: impacto ao fechar
    const kind = r < 0.5 ? 0 : r < 0.8 ? 1 : 2;
    sand.push({
      kind, side: Math.random() < 0.5 ? -1 : 1, u: Math.random(), z: Math.random(),
      birth: kind === 0 ? 0.13 + Math.random() * 0.33 : kind === 1 ? 0.28 + Math.random() * 0.22 : 0.5 + Math.random() * 0.06,
      vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.4,
    });
  }
  const sandGeo = new THREE.BufferGeometry();
  const sandPos = new Float32Array(SAND * 3);
  sandGeo.setAttribute('position', new THREE.BufferAttribute(sandPos, 3));
  const sandPts = new THREE.Points(sandGeo, new THREE.PointsMaterial({ color: '#d7b086', size: 0.035, transparent: true, opacity: 0.95, depthWrite: false }));
  sandPts.frustumCulled = false;
  scene.add(sandPts);

  const puffTex = radialTexture([[0, 0.55], [0.5, 0.22], [1, 0]]);
  const puffs = [];
  const addPuff = (kind, x, z, birth) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: '#d9b28a', transparent: true, depthWrite: false, opacity: 0 }));
    sp.userData = { kind, x, z, birth };
    scene.add(sp);
    puffs.push(sp);
  };
  for (let i = 0; i < 9; i++) addPuff(0, (Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 1.6 + 0.4, 0.13 + Math.random() * 0.12);
  for (let i = 0; i < 10; i++) addPuff(1, (i % 2 ? 1 : -1) * 2.2, -1 - Math.random() * 9, 0.27 + Math.random() * 0.12);
  for (let i = 0; i < 9; i++) addPuff(2, (Math.random() - 0.5) * 3.2, (Math.random() - 0.5) * 1.4 + 0.6, 0.5 + Math.random() * 0.03);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 96), new THREE.MeshBasicMaterial({ color: '#f3d2ac', transparent: true, opacity: 0, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  scene.add(ring);

  // Abertura em dois tempos: uma fresta de luz, uma pausa, e o giro pesado das metades
  function openAmount(p) {
    const crack = smooth(0.12, 0.19, p);
    const swing = easeIO(smooth(0.21, 0.46, p));
    return { o: crack * 0.04 + swing * 0.96, crack, swing };
  }
  const halfX = (o, spread) => W / 4 + o * spread;

  function update(s, camera) {
    const { n, t, mx, my, mode } = s;
    const contact = mode === 'contact';
    const p = contact ? 0 : s.journey;
    const c = contact ? s.contact : 0;
    const spread = camera.aspect < 1 ? 2.15 : 1.6;

    if (!dragging) { rotV += (-rot * 0.012 - rotV * 0.09) * n; rot += rotV * n; }
    mono.rotation.y = (contact ? -0.35 : -0.55 * (1 - smooth(0, 0.14, p))) + rot;

    let o, swing, flare = 0, shake = 0;
    if (contact) {
      // Fechamento: as metades ganham velocidade até o impacto em c = 0,5
      const k = smooth(0.1, 0.5, c);
      swing = 1 - k * k * k;
      o = swing;
      flare = bump(0.49, 0.66, c);
      shake = 0.07 * bump(0.495, 0.6, c);
    } else {
      const a = openAmount(p);
      o = a.o; swing = a.swing;
      flare = bump(0.12, 0.22, p) * 0.8;
      shake = 0.03 * bump(0.12, 0.2, p) + 0.016 * bump(0.21, 0.46, p) + 0.022 * bump(0.27, 0.5, p);
    }
    halves[0].position.x = -halfX(o, spread);
    halves[1].position.x = halfX(o, spread);
    halves[0].rotation.y = swing * 0.42;
    halves[1].rotation.y = -swing * 0.42;

    const pulse = s.paused ? 0.85 : 0.72 + Math.sin(t * 1.7) * 0.28;
    seamMat.opacity = Math.min(1, Math.max(0, 1 - swing * 4) * pulse + flare * 1.5 + (s.hover ? 0.3 : 0));
    seamMat.color.copy(AMBER).multiplyScalar(2.6 + flare * 6);
    edgeMat.color.copy(AMBER).multiplyScalar(0.4 + o * 3.2 + flare * 4);
    portalMat.opacity = smooth(0.02, 0.4, o);
    beams.forEach((b, i) => { b.material.opacity = (smooth(0.03, 0.6, o) * (0.16 - i * 0.02) + flare * 0.05) * (s.paused ? 1 : 0.85 + Math.sin(t * 0.9 + i * 1.7) * 0.15); });
    const gs = 2.4 + o * 9 + flare * 6 + (s.hover ? 1 : 0);
    glow.scale.set(gs, gs, 1);
    glow.material.opacity = (0.18 + o * 0.5 + flare * 0.5) * (1 - smooth(0.46, 0.6, p));
    inner.intensity = o * 38 + flare * 40;

    const rise = contact ? 0 : easeIO(smooth(0.26, 0.5, p));
    walls.forEach((w) => { w.position.y = lerp(-H * 0.55, H / 2 + 0.18, rise); w.visible = rise > 0.001; });
    corrFloor.visible = rise > 0.001;
    corrFloor.position.y = lerp(-0.3, 0.04, rise);
    lineMat.opacity = smooth(0.42, 0.56, p) * (contact ? 0 : 1);
    floorLine.visible = lineMat.opacity > 0.001;

    // Areia escorrendo das bordas e do topo das paredes
    const driver = contact ? c : p;
    for (let i = 0; i < SAND; i++) {
      const g = sand[i], j = i * 3;
      const active = (g.kind === 2) === contact;
      const tau = (driver - g.birth) * 9;
      let y = -10, x = 0, z = 0;
      if (active && tau > 0) {
        if (g.kind === 1) {
          const wy = lerp(-H * 0.55, H / 2 + 0.18, easeIO(smooth(0.26, 0.5, g.birth))) + H / 2;
          x = g.side * (1.95 + 0.25 * (g.u - 0.5)) + g.vx * tau * 0.4;
          z = -0.6 - g.z * 10;
          y = wy - 4.9 * tau * tau;
        } else {
          const ob = g.kind === 2 ? 0.02 : openAmount(g.birth).o;
          const hx = halfX(ob, spread);
          x = g.side * (hx + (g.u - 0.5) * (W / 2)) + g.vx * tau;
          z = (g.z - 0.5) * D + g.vz * tau;
          y = H + 0.18 - 4.9 * tau * tau;
        }
      }
      sandPos[j] = x; sandPos[j + 1] = y > 0.02 ? y : -10; sandPos[j + 2] = z;
    }
    sandGeo.attributes.position.needsUpdate = true;

    // Nuvens de poeira na base (abrir, paredes subindo, impacto)
    puffs.forEach((sp) => {
      const d = sp.userData;
      const active = (d.kind === 2) === contact;
      const tau = active ? driver - d.birth : -1;
      if (tau <= 0) { sp.material.opacity = 0; return; }
      const life = d.kind === 2 ? 0.12 : 0.16;
      const k = Math.min(1, tau / life);
      sp.material.opacity = Math.sin(Math.PI * k) * (d.kind === 2 ? 0.55 : 0.4);
      const sc = 0.8 + k * (d.kind === 2 ? 5 : 3.2);
      sp.scale.set(sc * 1.6, sc, 1);
      sp.position.set(d.x * (1 + k * 0.6), 0.3 + k * 0.9, d.z + (d.kind === 2 ? k * 0.8 : 0));
    });
    const rk = contact ? smooth(0.5, 0.68, c) : 0;
    ring.material.opacity = rk > 0 && rk < 1 ? (1 - rk) * 0.5 : 0;
    ring.scale.setScalar(1 + rk * 16);

    // Céu: anoitece no contato
    const dusk = contact ? 0.35 + c * 0.65 : 0;
    skyMat.uniforms.uWhite.value = 0;
    skyMat.uniforms.uDusk.value = dusk;
    skyMat.uniforms.uTime.value = t;
    scene.fog.color.copy(FOG).lerp(FOG_DUSK, dusk);
    ranges.forEach((r) => r.material.color.copy(r.userData.base).lerp(FOG_DUSK, dusk * 0.5));
    sun.intensity = lerp(3.6, 2.4, dusk);
    hemi.intensity = lerp(0.75, 0.5, dusk);

    sunTmp.copy(sunBase).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -mx * 0.14);
    sunTmp.y += -my * 0.03 - dusk * 0.06;
    sunDir.copy(sunTmp).normalize();
    sun.position.copy(sunDir).multiplyScalar(45);

    // Câmera: trilho + paralaxe + tremor do peso da pedra (só enquanto há movimento)
    if (contact) {
      tmpP.set(lerp(-7, -3.8, easeIO(c)), lerp(1.05, 1.45, c), lerp(13, 9.6, easeIO(c)));
      tmpL.set(0, 2.5, 0);
    } else {
      const u = toU(p);
      posCurve.getPoint(u, tmpP);
      lookCurve.getPoint(u, tmpL);
      const k = ease(s.intro);
      tmpP.lerpVectors(craneFrom, tmpP, k);
      tmpL.lerpVectors(craneLook, tmpL, k);
    }
    const par = contact ? 1 : 1 - smooth(0.2, 0.55, p);
    const breath = s.paused ? 0 : Math.sin(t * 0.35) * 0.05;
    const quake = s.paused ? 0 : shake * Math.min(1, 0.25 + (s.vel || 0) * 3);
    camera.position.set(
      tmpP.x + mx * 0.5 * par + quake * (Math.sin(t * 43) + Math.sin(t * 29.3)) * 0.5,
      tmpP.y - my * 0.24 * par + breath + quake * Math.sin(t * 37.1) * 0.6,
      tmpP.z,
    );
    camera.lookAt(tmpL);
    sky.position.copy(camera.position);

    if (!s.paused) {
      const a = dustGeo.attributes.position.array;
      for (let i = 0; i < DUST; i++) {
        a[i * 3] += 0.007 * n;
        a[i * 3 + 1] += Math.sin(t * 0.6 + seeds[i]) * 0.0017 * n;
        if (a[i * 3] > 15) a[i * 3] = -15;
      }
      dustGeo.attributes.position.needsUpdate = true;
    }
    return { open: o, white: 0 };
  }

  // HDRI do deserto: só depois do primeiro quadro e com o navegador ocioso (o hero nunca espera por ele)
  new Promise((r) => (window.requestIdleCallback || setTimeout)(r, { timeout: 2500 }))
    .then(() => loadHDR(renderer, 'quarry_01', { mobile, sunDir: sunBase }))
    .then(({ env }) => { scene.environment.dispose(); scene.environment = env; envIntensity(scene, 0.8); })
    .catch((err) => console.warn('[MONÓLITO] HDRI', err));

  return {
    scene, update, targets: halves,
    canDrag: (s) => (s.mode === 'contact' ? true : s.journey < 0.12),
    drag(dx) { dragging = true; rotV = dx * 0.0045; rot += rotV; },
    release() { dragging = false; },
    ao: { radius: 1.2, intensity: 2.5 },
    bloom: { strength: 0.42, radius: 0.38, threshold: 1.0 },
  };
}
