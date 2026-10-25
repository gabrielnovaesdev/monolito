const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const { gsap, ScrollTrigger, CustomEase, Lenis } = window;
if (reduced) root.classList.add('reduced');

/* ============ Linguagem de movimento ============ */
let E = { out: 'expo.out', inout: 'power4.inOut', soft: 'power2.out' };
if (gsap && CustomEase) {
  gsap.registerPlugin(ScrollTrigger, CustomEase);
  E = {
    out: CustomEase.create('out', '.16,1,.3,1'),
    inout: CustomEase.create('inout', '.76,0,.24,1'),
    soft: CustomEase.create('soft', '.25,.1,0,1'),
  };
}

/* ============ Rolagem suave ============ */
let lenis = null;
if (gsap && ScrollTrigger && Lenis && !reduced) {
  lenis = new Lenis({ duration: 1.5, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), wheelMultiplier: 0.9 });
  lenis.on('scroll', ScrollTrigger.update);
  lenis.on('scroll', () => engine?.setVelocity(lenis.velocity));
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop();
}
window.__mono = { get lenis() { return lenis; }, get engine() { return engine; } };

/* ============ Loader com progresso real ============ */
const loader = $('.loader');
const parts = { fonts: 0, scene: 0 };
const target = () => 30 * parts.fonts + 70 * parts.scene;

const fontsReady = new Promise((res) => {
  const link = $('link[rel="stylesheet"][media]');
  const go = () => document.fonts.ready.then(res);
  if (link.media === 'all') go(); else link.addEventListener('load', go, { once: true });
  setTimeout(res, 2500);
}).then(() => { parts.fonts = 1; });

let engine = null;
const cursor = { el: $('.cursor'), label: $('.cursor__label') };
const sceneReady = import('./engine.js')
  .then(({ createEngine }) => {
    engine = createEngine($('.scene'), { onHover: setGrab, onIndex: setWork, onContextLost: toFallback });
    // O 3D pode chegar depois da entrada (conexão lenta): assume o estado atual da página
    if (root.classList.contains('is-ready')) {
      engine.setIntro(intro.v);
      if (built) ScrollTrigger?.refresh();
      if (intro.v >= 1) engine.preload();
    }
    if (reduced) { engine.setPaused(true); engine.setIntro(1); }
  })
  .catch((err) => {
    console.warn('[MONÓLITO] WebGL indisponível, usando versão estática.', err);
    toFallback();
  })
  .finally(() => { parts.scene = 1; });

let failed = false, built = false;
const intro = { v: 0 };
function toFallback() {
  failed = true;
  root.classList.add('is-fallback');
  $('.scene')?.remove();
  $$('[data-count]').forEach((el) => (el.textContent = el.dataset.count));
  $$('.chapter').forEach((c) => (c.style.visibility = 'visible'));
  ScrollTrigger?.refresh();
}

const all = Promise.all([fontsReady, sceneReady]);

if (!gsap || reduced) {
  all.finally(() => { loader?.remove(); root.classList.add('is-ready'); safeBuild(); engine?.setIntro(1); engine?.preload(); });
} else {
  runLoader();
}

function safeBuild() { try { build(); } catch (err) { console.error('[MONÓLITO]', err); } }

function runLoader() {
  const t0 = performance.now();
  const pct = $('.loader__pct'), bar = $('.loader__bar'), seam = $('.loader__mark span');
  let shown = 0, done = false, finished = false;
  all.then(() => { done = true; });
  setTimeout(() => finish(), 8000); // trava de segurança fora do rAF
  (function tick(now) {
    if (finished) return;
    const el = now - t0;
    const floor = Math.min(92, 88 * (1 - Math.exp(-el / 2200)));
    shown += (Math.max(target(), floor) - shown) * 0.1;
    if (!loader.isConnected) return finish();
    pct.textContent = `${Math.round(shown)} %`;
    bar.style.setProperty('--p', shown / 100);
    seam.style.transform = `scaleY(${shown / 100})`;
    if (done && el > 1600) return finish();
    requestAnimationFrame(tick);
  })(performance.now());

  function finish() {
    if (finished) return;
    finished = true;
    pct.textContent = '100 %';
    bar.style.setProperty('--p', 1);
    seam.style.transform = 'scaleY(1)';
    root.classList.add('is-ready');
    safeBuild();
    const curtain = loader && loader.isConnected ? loader : null; // a trava do <head> pode já ter removido
    gsap.timeline({ delay: 0.2 })
      // A cortina abre pela fenda do monólito: um recorte vertical que se alarga
      .add(() => curtain && gsap.to(curtain, { clipPath: 'inset(0% 50% 0% 50%)', duration: 1.3, ease: E.inout, onComplete: () => curtain.remove() }), 0)
      .to(intro, { v: 1, duration: 3.6, ease: E.soft, onUpdate: () => engine?.setIntro(intro.v) }, 0.1)
      .from('.hero__title .ln > span', { yPercent: 115, duration: 1.6, stagger: 0.12, ease: E.out }, 1.4)
      .from('.hero__meta > *, .hero__lede, .hero__cue, .nav > *, .hud > *', { opacity: 0, y: 12, filter: 'blur(6px)', duration: 1.2, stagger: 0.06, ease: E.out, clearProps: 'filter' }, 1.8)
      .add(() => lenis?.start(), 1.6)
      .add(() => engine?.preload(), 3.8);
    if (curtain) gsap.set(curtain, { clipPath: 'inset(0% 0% 0% 0%)' });
  }
}

/* ============ Orquestração por rolagem ============ */
let workEls = [];
let paused = reduced;
function setWork(i) {
  workEls.forEach((w, k) => w.classList.toggle('is-on', k === i));
  const b = $('.gcount b');
  if (b) b.textContent = String(i + 1).padStart(2, '0');
}

function build() {
  setupCursor();
  setupPause();
  setupMagnetic();
  workEls = $$('.work');
  workEls.forEach((w) => $$('.ln', w).forEach((ln, i) => ln.style.setProperty('--i', i)));
  if (!gsap || !ScrollTrigger || failed) { toFallback(); return; }
  built = true;

  const journey = $('.journey'), gal = $('.gallery'), studio = $('.studio'), contact = $('.contact');
  const hud = $('.hud'), chapters = $$('.hud__chapters li'), drag = $('.hud__drag'), gprog = $('.gprog');

  // Camadas de texto da jornada: tudo acoplado ao progresso da rolagem (scrub)
  const lines = (sel) => `${sel} .ln > span`;
  gsap.set('.chapter--pass', { yPercent: -50 }); // centralização vertical: dono único é o GSAP
  // Os textos acompanham a coreografia da porta: fechada → fresta → giro → corredor → porta de luz
  const ov = gsap.timeline({ paused: true, defaults: { ease: 'none' } })
    .to('.hero', { opacity: 0, y: -60, duration: 0.07 }, 0.0)
    .set('.chapter--open', { visibility: 'visible' }, 0.035)
    .fromTo(lines('.chapter--open'), { yPercent: 115 }, { yPercent: 0, stagger: 0.01, duration: 0.05, ease: 'power2.out' }, 0.04)
    .to(lines('.chapter--open'), { yPercent: -115, stagger: 0.008, duration: 0.04, ease: 'power2.in' }, 0.17)
    .set('.chapter--pass', { visibility: 'visible' }, 0.5)
    .fromTo(lines('.chapter--pass'), { yPercent: 115 }, { yPercent: 0, stagger: 0.012, duration: 0.06, ease: 'power2.out' }, 0.51)
    .fromTo('.chapter--pass p', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.05 }, 0.55)
    .to('.chapter--pass', { opacity: 0, scale: 1.06, yPercent: -50, duration: 0.06 }, 0.72)
    .set({}, {}, 1);

  const range = (el) => {
    const r = el.getBoundingClientRect();
    return (0 - r.top) / Math.max(1, r.height - innerHeight);
  };
  const clamp = (v) => Math.min(1, Math.max(0, v));

  let mode = 'journey', lastIdx = -1;
  function sync() {
    const pj = clamp(range(journey));
    const pg = clamp(range(gal));
    const studioTop = studio.getBoundingClientRect().top;
    const contactR = contact.getBoundingClientRect();
    const pc = clamp(-contactR.top / Math.max(1, contactR.height - innerHeight));

    ov.progress(pj);
    engine?.setJourney(pj);
    engine?.setGallery(pg);
    engine?.setContact(pc);

    // Qual mundo renderizar: a porta de luz e o estúdio cobrem as trocas
    const rawG = range(gal);
    const next = rawG < 0 ? 'journey'
      : studioTop > 0 ? 'gallery'
      : contactR.top > innerHeight * 0.95 ? 'off'
      : 'contact';
    if (next !== mode) { mode = next; engine?.setMode(mode); }

    const idx = mode === 'contact' ? 3 : mode === 'gallery' || pj > 0.85 ? 2 : pj > 0.2 ? 1 : 0;
    if (idx !== lastIdx) { chapters.forEach((li, i) => li.classList.toggle('is-on', i === idx)); lastIdx = idx; }
    const onLight = mode === 'off';
    root.classList.toggle('on-light', onLight && !(mode === 'contact'));
    hud.classList.toggle('is-hidden', mode === 'off' || mode === 'contact');
    drag.style.opacity = pj < 0.04 ? 1 : 0;
    gal.classList.toggle('is-live', mode === 'gallery' && pg < 0.995);
    gprog.style.setProperty('--g', pg);
  }
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: sync, onRefresh: sync });
  sync();

  // Estúdio: frase revelada por linhas, contadores e letreiro que inclina com a velocidade
  const st = $('.statement');
  splitLines(st);
  gsap.from($$('.ln > span', st), { yPercent: 115, duration: 1.4, stagger: 0.08, ease: E.out, scrollTrigger: { trigger: st, start: 'top 80%', once: true } });
  $$('[data-count]').forEach((el) => {
    const o = { v: 0 };
    gsap.to(o, { v: +el.dataset.count, duration: 2, ease: E.out, onUpdate: () => (el.textContent = Math.round(o.v)), scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
  });
  gsap.from('.services li', { opacity: 0, y: 30, duration: 1.2, stagger: 0.1, ease: E.out, scrollTrigger: { trigger: '.services', start: 'top 80%', once: true } });

  const track = $('.marquee__track');
  const half = () => track.scrollWidth / 2;
  let mx = 0, skew = 0;
  const setX = gsap.quickSetter(track, 'x', 'px'), setSkew = gsap.quickSetter(track, 'skewX', 'deg');
  gsap.ticker.add((time, dt) => {
    if (reduced || paused) return;
    const v = lenis ? lenis.velocity : 0;
    mx -= (0.6 + Math.abs(v) * 0.25) * (dt / 16.67);
    if (-mx > half()) mx += half();
    skew += (Math.max(-8, Math.min(8, v * 0.3)) - skew) * 0.1;
    setX(mx); setSkew(skew);
  });

  // Contato: o título sobe quando a cena volta ao deserto
  gsap.from('.contact__title .ln > span', { yPercent: 115, duration: 1.4, stagger: 0.1, ease: E.out, scrollTrigger: { trigger: '.contact', start: 'top 30%', once: true } });
  gsap.from('.contact__row > *, .foot', { opacity: 0, y: 20, duration: 1.2, stagger: 0.08, ease: E.out, scrollTrigger: { trigger: '.contact', start: 'top 10%', once: true } });

  document.fonts.ready.then(() => ScrollTrigger.refresh());
}

// Divide um parágrafo em linhas reais (preservando <em>) para a máscara.
function splitLines(el) {
  const words = [];
  el.childNodes.forEach((n) => {
    const em = n.nodeType === 1;
    n.textContent.split(/(\s+)/).forEach((w) => { if (w.trim()) words.push(em ? `<em>${w}</em>` : w); });
  });
  const plain = el.textContent.replace(/\s+/g, ' ').trim();
  el.innerHTML = words.map((w) => `<span class="w" style="display:inline-block">${w}</span>`).join(' ');
  const rows = [];
  let top = null;
  $$('.w', el).forEach((w) => {
    if (top === null || Math.abs(w.offsetTop - top) > 4) { rows.push([]); top = w.offsetTop; }
    rows[rows.length - 1].push(w.innerHTML);
  });
  el.innerHTML = rows.map((r) => `<span class="ln" aria-hidden="true"><span>${r.join(' ')}</span></span>`).join('') + `<span class="sr-only">${plain}</span>`;
}

/* ============ Cursor ============ */
function setGrab(txt) {
  if (!root.classList.contains('has-cursor')) return;
  cursor.el.classList.toggle('is-grab', !!txt);
  if (txt) cursor.label.textContent = txt;
}
function setupCursor() {
  if (!fine || !gsap || reduced) return;
  root.classList.add('has-cursor');
  const x = gsap.quickTo(cursor.el, 'x', { duration: 0.45, ease: 'power3' });
  const y = gsap.quickTo(cursor.el, 'y', { duration: 0.45, ease: 'power3' });
  addEventListener('pointermove', (e) => { x(e.clientX); y(e.clientY); }, { passive: true });
  addEventListener('pointerdown', () => cursor.el.classList.add('is-down'));
  addEventListener('pointerup', () => cursor.el.classList.remove('is-down'));
  document.addEventListener('pointerover', (e) => cursor.el.classList.toggle('is-link', !!e.target.closest('a, button')));
}

function setupMagnetic() {
  if (!fine || !gsap || reduced) return;
  $$('.magnetic').forEach((el) => {
    const mx = gsap.quickTo(el, 'x', { duration: 0.9, ease: 'elastic.out(1, .4)' });
    const my = gsap.quickTo(el, 'y', { duration: 0.9, ease: 'elastic.out(1, .4)' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      mx((e.clientX - r.left - r.width / 2) * 0.3);
      my((e.clientY - r.top - r.height / 2) * 0.35);
    });
    el.addEventListener('pointerleave', () => { mx(0); my(0); });
  });
}

/* ============ Pausar movimento ============ */
function setupPause() {
  const b = $('.hud__pause');
  if (reduced) { b.setAttribute('aria-pressed', 'true'); b.textContent = 'Movimento reduzido'; }
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on);
    b.textContent = on ? 'Retomar movimento' : 'Pausar movimento';
    paused = on;
    engine?.setPaused(on);
  });
}

$$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const t = $(a.getAttribute('href'));
  if (!t) return;
  e.preventDefault();
  const y = t.id === 'galeria' ? t.offsetTop + innerHeight * 0.6 : t.offsetTop;
  lenis ? lenis.scrollTo(y, { duration: 2.4, easing: (x) => 1 - Math.pow(1 - x, 4) }) : scrollTo(0, y);
}));
