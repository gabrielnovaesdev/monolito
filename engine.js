// Motor: mundos (deserto + 4 projetos), transições por máscara de luz e pós-processamento.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { createDesert, smooth } from './desert.js';

// Acabamento de lente: aberração cromática nas bordas, saturação/contraste pós-AgX, vinheta e grão animado.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAberr: { value: 0.002 }, uVignette: { value: 0.85 }, uGrain: { value: 0.035 }, uSat: { value: 1.22 }, uCurve: { value: 0.35 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uAberr, uVignette, uGrain, uSat, uCurve; varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5; float d = length(c);
      vec2 off = c * uAberr * d * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      // AgX "punchy": devolve a saturação e o contraste que a curva base tira
      col = clamp(col, 0.0, 1.0);
      col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSat);
      col = mix(col, col * col * (3.0 - 2.0 * col), uCurve);
      col *= mix(1.0, smoothstep(0.95, 0.2, d), uVignette * 0.55);
      col += (rnd(gl_FragCoord.xy + fract(uTime * 7.13) * 97.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Bokeh sutil (só nos projetos, desktop): desfoque por coleta em espiral a partir da profundidade do N8AO.
// Uma amostra mais próxima que o pixel só entra se o próprio desfoque dela o alcança (silhuetas nítidas).
const DofShader = {
  uniforms: { tColor: { value: null }, tDepth: { value: null }, uFocus: { value: 30 }, uAperture: { value: 6 }, uMaxBlur: { value: 7 }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    #include <packing>
    uniform sampler2D tColor, tDepth; uniform float uFocus, uAperture, uMaxBlur, uNear, uFar; uniform vec2 uRes; varying vec2 vUv;
    float vz(vec2 uv) { return -perspectiveDepthToViewZ(textureLod(tDepth, uv, 0.0).x, uNear, uFar); }
    float coc(float z) { return clamp(uAperture * abs(z - uFocus) / max(z, 0.01), 0.0, uMaxBlur); }
    void main() {
      float z = vz(vUv), c = textureLod(tDepth, vUv, 0.0).x > 0.99999 ? 0.0 : coc(z); // o céu fica nítido (estrelas não viram discos)
      vec3 acc = texture2D(tColor, vUv).rgb; float w = 1.0;
      if (c > 0.6) {
        for (int i = 0; i < 24; i++) {
          float r = sqrt((float(i) + 0.5) / 24.0) * c, a = float(i) * 2.39996;
          vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
          float zs = vz(uv);
          float k = zs >= z - 0.05 ? 1.0 : clamp(coc(zs) - r + 1.0, 0.0, 1.0);
          acc += textureLod(tColor, uv, 0.0).rgb * k; w += k;
        }
      }
      gl_FragColor = vec4(acc / w, 1.0);
    }`,
};

// Renderiza um mundo, ou dois misturados por uma máscara: fenda vertical (entre projetos)
// ou porta retangular que cresce (saída do corredor). A borda da máscara brilha em âmbar (HDR → bloom).
class WorldMixPass extends Pass {
  constructor(renderer) {
    super();
    const opts = { type: THREE.HalfFloatType };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.a = null; this.b = null; this.mix = 0; this.mask = 0;
    this.ao = null; // N8AOPass compartilhado pelos mundos (desktop)
    this.dof = null; // quadro do bokeh (desktop)
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tA: { value: null }, tB: { value: null }, uMix: { value: 0 }, uMask: { value: 0 }, uAspect: { value: 1 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tA, tB; uniform float uMix, uMask, uAspect, uTime; varying vec2 vUv;
        float h(float x){ return fract(sin(x * 91.17) * 43758.5); }
        float n1(float x){ float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
        void main(){
          vec2 p = vUv - 0.5;
          float d;
          if (uMask < 0.5) {
            // Fenda vertical que se abre do centro, com borda levemente irregular
            float w = pow(uMix, 1.35) * 0.52;
            d = abs(p.x) - w - (n1(vUv.y * 18.0 + uTime * 0.6) - 0.5) * 0.006 * (1.0 - uMix);
          } else {
            // Porta: retângulo vertical que cresce até cobrir a tela
            float k = pow(uMix, 1.8);
            vec2 hs = mix(vec2(0.045 / uAspect * 1.6, 0.17), vec2(0.62, 0.62), k);
            vec2 q = abs(p) - hs; d = max(q.x, q.y);
          }
          float m = 1.0 - smoothstep(-0.0015, 0.0015, d);
          vec3 col = mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, m);
          float live = step(0.001, uMix) * step(uMix, 0.999);
          col += vec3(1.0, 0.62, 0.32) * exp(-abs(d) * 160.0) * 3.0 * live;
          col += vec3(1.0, 0.75, 0.5) * exp(-abs(d) * 22.0) * 0.25 * live;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
  }
  setSize(w, h) {
    this.w = w; this.h = h;
    this.rtA.setSize(w, h); this.rtB.setSize(w, h); this.rtT.setSize(w, h);
    this.ao?.setSize(w, h);
    this.dof?.material.uniforms.uRes.value.set(w, h);
    this.quad.material.uniforms.uAspect.value = w / h;
  }
  // Um mundo: cena → (oclusão de ambiente) → (bokeh) → alvo
  draw(renderer, W, target) {
    const ao = this.ao;
    if (!ao || !W.ao) { renderer.setRenderTarget(target); renderer.render(W.scene, W.camera); return; }
    const c = ao.configuration;
    if (c.aoRadius !== W.ao.radius) c.aoRadius = W.ao.radius;
    if (c.intensity !== W.ao.intensity) c.intensity = W.ao.intensity;
    if (c.distanceFalloff !== (W.ao.falloff ?? 1)) c.distanceFalloff = W.ao.falloff ?? 1;
    ao.scene = W.scene; ao.camera = W.camera;
    const focus = this.dof && W.camera.userData.focus;
    ao.render(renderer, focus ? this.rtT : target);
    if (!focus) return;
    const u = this.dof.material.uniforms;
    u.tColor.value = this.rtT.texture; u.tDepth.value = ao.beautyRenderTarget.depthTexture;
    u.uFocus.value = focus; u.uNear.value = W.camera.near; u.uFar.value = W.camera.far;
    u.uAperture.value = 7 * (this.h / 900); u.uMaxBlur.value = 6 * (this.h / 900);
    renderer.setRenderTarget(target);
    this.dof.render(renderer);
  }
  render(renderer, writeBuffer) {
    const target = this.renderToScreen ? null : writeBuffer;
    if (!this.b || this.mix <= 0.0005) return this.draw(renderer, this.a, target);
    if (this.mix >= 0.9995) return this.draw(renderer, this.b, target);
    this.draw(renderer, this.a, this.rtA);
    this.draw(renderer, this.b, this.rtB);
    const u = this.quad.material.uniforms;
    u.tA.value = this.rtA.texture; u.tB.value = this.rtB.texture; u.uMix.value = this.mix; u.uMask.value = this.mask;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }
}

export function createEngine(canvas, { onHover, onIndex, onContextLost } = {}) {
  const mobile = matchMedia('(max-width: 820px), (pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost?.(); });

  const desertCam = new THREE.PerspectiveCamera(36, 1, 0.1, 700);
  const desertCore = createDesert(renderer, { mobile });
  const desert = { ...desertCore, camera: desertCam, kind: 'desert' };

  // Projetos: criados sob demanda (e em segundo plano depois da entrada)
  // Cada projeto só entra em cena depois que HDRI e texturas chegaram (e o shader final foi compilado).
  const projects = [null, null, null, null], building = [];
  let projectsModule = null;
  function ensureProject(i) {
    return (building[i] ??= (async () => {
      projectsModule ??= import('./projects.js');
      const mod = await projectsModule;
      const p = mod.PROJECTS[i](renderer, { mobile });
      p.kind = 'project';
      fitCamera(p.camera);
      await p.ready?.catch(() => {});
      await renderer.compileAsync(p.scene, p.camera); // compila em paralelo (KHR_parallel_shader_compile), sem travar a rolagem
      projects[i] = p;
      return p;
    })());
  }
  async function preload() {
    for (let i = 0; i < 4; i++) {
      await ensureProject(i).catch((err) => console.warn('[MONÓLITO] projeto', i, err));
      await new Promise((r) => (window.requestIdleCallback || setTimeout)(r, { timeout: 600 }));
    }
  }

  const composer = new EffectComposer(renderer);
  const mixPass = new WorldMixPass(renderer);
  mixPass.a = desert;
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.4, 1.0);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(mixPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  if (!mobile) composer.addPass(new SMAAPass(1, 1)); // anti-aliasing depois do tone mapping
  composer.addPass(grade);

  // Oclusão de ambiente N8AO (CDN, versão fixa) e bokeh: só no desktop, chegam depois do primeiro quadro
  if (!mobile) {
    import('n8ao').then(({ N8AOPass }) => {
      const ao = new N8AOPass(desert.scene, desertCam, mixPass.w || 1, mixPass.h || 1);
      Object.assign(ao.configuration, { aoSamples: 16, denoiseSamples: 8, denoiseRadius: 12, denoiseIterations: 2, halfRes: true, depthAwareUpsampling: true, gammaCorrection: false, transparencyAware: false });
      mixPass.ao = ao;
      mixPass.dof = new FullScreenQuad(new THREE.ShaderMaterial(DofShader));
      mixPass.setSize(mixPass.w, mixPass.h);
    }).catch((err) => console.warn('[MONÓLITO] N8AO indisponível', err));
  }

  const s = { n: 1, t: 0, mx: 0, my: 0, journey: 0, gallery: 0, contact: 0, mode: 'journey', intro: 0, paused: false, hover: false, vel: 0 };
  const target = { journey: 0, gallery: 0, contact: 0, mx: 0, my: 0 };
  let velocity = 0, lastOff = -1, fov = 36, raf = 0, last = performance.now();
  let dragging = null, lastX = 0, hoverLabel = '', lastIndex = -1;

  /* ---------- Qual mundo (ou par de mundos) mostrar agora ---------- */
  const DOOR = 0.8; // na jornada, a porta de luz começa aqui
  const SEG_SHOW = 0.76; // em cada trecho da galeria: 76% mostrando, 24% em transição
  function view() {
    if (s.mode === 'contact') return { a: desert, b: null, mix: 0, idx: 3 };
    if (s.mode === 'journey') {
      const m = smooth(DOOR, 1, s.journey);
      const p0 = projects[0];
      if (m > 0 && p0) { p0.update(0, s); return { a: desert, b: p0, mix: m, mask: 1, idx: 0 }; }
      return { a: desert, b: null, mix: 0, idx: 0 };
    }
    // Galeria: quatro trechos; no fim de cada um, a fenda revela o próximo projeto
    const f = Math.min(3.9999, s.gallery * 4), i = Math.floor(f), local = f - i;
    const A = projects[i] || desert;
    const u = Math.min(1, local / SEG_SHOW);
    if (A !== desert) A.update(u, s);
    const m = i < 3 ? smooth(SEG_SHOW, 1, local) : 0;
    const B = m > 0 ? projects[i + 1] : null;
    if (B) B.update(0, s);
    return { a: A, b: B, mix: B ? m : 0, mask: 0, idx: B && m > 0.5 ? i + 1 : i };
  }

  /* ---------- Ponteiro ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hitDesert = (e) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, desertCam);
    return ray.intersectObjects(desert.targets, false).length > 0;
  };
  const blocked = (e) => e.target.closest?.('a, button, .studio, input');
  const label = (txt) => { if (txt !== hoverLabel) { hoverLabel = txt; s.hover = txt === 'Arraste'; onHover?.(txt); } };
  let current = { a: desert };
  const onDesert = () => current.a === desert && !current.b;

  addEventListener('pointermove', (e) => {
    target.mx = (e.clientX / innerWidth) * 2 - 1;
    target.my = (e.clientY / innerHeight) * 2 - 1;
    if (dragging) { dragging.drag(e.clientX - lastX); lastX = e.clientX; return; }
    if (e.pointerType !== 'mouse' || blocked(e) || s.mode === 'off') return label('');
    if (s.mode === 'gallery') return label(current.a.kind === 'project' && !current.b ? 'Orbitar' : '');
    label(onDesert() && desert.canDrag(s) && hitDesert(e) ? 'Arraste' : '');
  }, { passive: true });
  addEventListener('pointerdown', (e) => {
    if (blocked(e) || s.mode === 'off' || current.b) return;
    if (s.mode === 'gallery') {
      if (e.pointerType !== 'mouse' || current.a.kind !== 'project') return; // no toque, o gesto é rolagem
      dragging = current.a;
    } else {
      if (!desert.canDrag(s) || !hitDesert(e)) return;
      dragging = desert;
    }
    lastX = e.clientX;
  });
  const up = () => { if (dragging) { dragging.release(); dragging = null; } };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);

  /* ---------- Tamanho ---------- */
  function fitCamera(cam) {
    cam.aspect = innerWidth / innerHeight;
    if (cam !== desertCam) cam.fov = cam.aspect < 1 ? 56 : 34; // retrato: lente mais aberta para caber o edifício
    // Projetos em paisagem: edifício à direita, ficha técnica à esquerda
    if (cam !== desertCam && cam.aspect > 1.1) cam.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.13, 0, innerWidth, innerHeight);
    else if (cam !== desertCam) cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(Math.round(w / 2), Math.round(h / 2));
    desertCam.clearViewOffset();
    lastOff = -1;
    [desertCam, ...projects.filter(Boolean).map((p) => p.camera)].forEach(fitCamera);
  }
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 120); });
  resize();

  /* ---------- Laço ---------- */
  function frame(now) {
    raf = 0;
    if (s.mode === 'off') return;
    const dt = Math.max(1, Math.min(64, now - last));
    last = now;
    s.n = dt / 16.67;
    if (!s.paused) s.t += dt / 1000;
    const k = 1 - Math.pow(0.88, s.n), km = 1 - Math.pow(0.94, s.n);
    s.journey += (target.journey - s.journey) * k;
    s.gallery += (target.gallery - s.gallery) * k;
    s.contact += (target.contact - s.contact) * k;
    s.mx += (target.mx - s.mx) * km;
    s.my += (target.my - s.my) * km;
    s.vel += (Math.min(1, Math.abs(velocity) / 60) - s.vel) * (1 - Math.pow(0.9, s.n));
    velocity *= Math.pow(0.9, s.n);

    // O deserto atualiza sempre que aparece (sozinho ou como origem da porta)
    let info = { open: 0 };
    if (s.mode !== 'gallery') info = desert.update(s, desertCam);

    const v = view();
    current = v;
    mixPass.a = v.a; mixPass.b = v.b; mixPass.mix = v.mix; mixPass.mask = v.mask || 0;
    mixPass.quad.material.uniforms.uTime.value = s.t;

    // Bloom e lente interpolados entre os dois mundos
    const bA = v.a.bloom, bB = v.b ? v.b.bloom : bA, m = v.mix;
    bloom.strength = bA.strength + (bB.strength - bA.strength) * m + (v.b && m > 0 && m < 1 ? 0.25 * Math.sin(Math.PI * m) : 0);
    bloom.radius = bA.radius + (bB.radius - bA.radius) * m;
    bloom.threshold = bA.threshold + (bB.threshold - bA.threshold) * m;

    // Lente do deserto: abre com a velocidade e ao atravessar a passagem
    const base = desertCam.aspect < 1 ? 52 : 36;
    const want = base + s.vel * 7 + (s.mode === 'journey' ? (info.open || 0) * 6 : 0);
    if (Math.abs(want - fov) > 0.01) { fov += (want - fov) * k; desertCam.fov = fov; desertCam.updateProjectionMatrix(); }
    const off = desertCam.aspect <= 1.1 ? 0
      : s.mode === 'journey' ? (1 - smooth(0.04, 0.3, s.journey)) * 0.17
      : s.mode === 'contact' ? 0.2 : 0;
    if (Math.abs(off - lastOff) > 1e-4) {
      if (off > 1e-4) desertCam.setViewOffset(innerWidth, innerHeight, -innerWidth * off, 0, innerWidth, innerHeight);
      else desertCam.clearViewOffset();
      lastOff = off;
    }

    if (s.mode === 'gallery' && v.idx !== lastIndex) { lastIndex = v.idx; onIndex?.(v.idx); }

    grade.uniforms.uTime.value = s.t;
    grade.uniforms.uAberr.value = 0.0015 + s.vel * 0.006 + (v.b ? Math.sin(Math.PI * m) * 0.004 : 0);
    grade.uniforms.uVignette.value = 0.85;
    grade.uniforms.uGrain.value = 0.032;

    composer.render();
    raf = requestAnimationFrame(frame);
  }

  renderer.compile(desert.scene, desertCam);
  composer.render();
  raf = requestAnimationFrame(frame);

  return {
    preload,
    ensureProject,
    debug: () => ({ mode: s.mode, ready: projects.map(Boolean), g: +s.gallery.toFixed(3), j: +s.journey.toFixed(3), cams: projects.map((p) => p && p.camera.position.toArray().map((v) => +v.toFixed(1))), aspect: projects[0]?.camera.aspect }),
    setJourney(p) { target.journey = p; if (p > 0.7) ensureProject(0); },
    setGallery(g) { target.gallery = g; },
    setContact(c) { target.contact = c; },
    setIntro(v) { s.intro = v; },
    setPaused(v) { s.paused = v; },
    setVelocity(v) { velocity = v; },
    setMode(m) {
      if (m === s.mode) return;
      up();
      label('');
      const was = s.mode;
      s.mode = m;
      if (m === 'gallery') { const i = Math.min(3, Math.floor(target.gallery * 4)); ensureProject(i); if (i < 3) ensureProject(i + 1); }
      if (m === 'contact') s.contact = target.contact;
      if (m === 'gallery') s.gallery = target.gallery;
      if (was === 'off' && m !== 'off' && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    },
  };
}
