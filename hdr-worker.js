// Worker do HDRI: baixa o .hdr, decodifica o RGBE, acha o sol, gira o panorama para alinhar o sol
// com o da cena, mede a cor do horizonte e corta o pico do sol para o mapa de ambiente.
// Tudo fora da thread principal; devolve RGBA em meio-float (linha 0 = topo).
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return e < -10 ? s : s | ((m | 0x800000) >> (1 - e + 13));
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >> 13);
}
function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
}
function decode(buf) {
  const b = new Uint8Array(buf);
  let p = 0, line = '', w = 0, h = 0;
  while (p < b.length) {
    const c = b[p++];
    if (c === 10) { const m = line.match(/^-Y (\d+) \+X (\d+)/); if (m) { h = +m[1]; w = +m[2]; break; } line = ''; } else line += String.fromCharCode(c);
  }
  const rgb = new Float32Array(w * h * 3), row = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (b[p] === 2 && b[p + 1] === 2) {
      p += 4;
      for (let ch = 0; ch < 4; ch++) {
        let x = 0;
        while (x < w) {
          let n = b[p++];
          if (n > 128) { n -= 128; const v = b[p++]; while (n--) row[(x++) * 4 + ch] = v; } else while (n--) row[(x++) * 4 + ch] = b[p++];
        }
      }
    } else { for (let i = 0; i < w * 4; i++) row[i] = b[p++]; }
    for (let x = 0; x < w; x++) {
      const e = row[x * 4 + 3], f = e ? Math.pow(2, e - 136) : 0, i = (y * w + x) * 3;
      rgb[i] = row[x * 4] * f; rgb[i + 1] = row[x * 4 + 1] * f; rgb[i + 2] = row[x * 4 + 2] * f;
    }
  }
  return { w, h, rgb };
}
onmessage = async ({ data: { id, url, sunAz, clamp } }) => {
  try {
    const { w, h, rgb } = decode(await (await fetch(url)).arrayBuffer());
    let best = 0, bi = 0;
    for (let i = 0; i < (w * h) / 2; i++) { const l = rgb[i * 3] * 0.21 + rgb[i * 3 + 1] * 0.72 + rgb[i * 3 + 2] * 0.07; if (l > best) { best = l; bi = i; } }
    const azH = (((bi % w) + 0.5) / w - 0.5) * Math.PI * 2;
    const shift = sunAz == null ? 0 : Math.round(((sunAz - azH) / (Math.PI * 2)) * w);
    const hz = [0, 0, 0]; let n = 0;
    for (let y = Math.floor(h * 0.466); y < h / 2; y++) for (let x = 0; x < w; x += 4) { const i = (y * w + x) * 3; hz[0] += rgb[i]; hz[1] += rgb[i + 1]; hz[2] += rgb[i + 2]; n++; }
    hz[0] /= n; hz[1] /= n; hz[2] /= n;
    const lim = Math.max(...hz) * clamp;
    const full = new Uint16Array(w * h * 4), env = new Uint16Array(w * h * 4), one = toHalf(1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3, o = (y * w + ((((x + shift) % w) + w) % w)) * 4;
      const r = rgb[i], g = rgb[i + 1], bl = rgb[i + 2], m = Math.max(r, g, bl), k = m > lim ? lim / m : 1;
      full[o] = toHalf(r); full[o + 1] = toHalf(g); full[o + 2] = toHalf(bl); full[o + 3] = one;
      env[o] = toHalf(r * k); env[o + 1] = toHalf(g * k); env[o + 2] = toHalf(bl * k); env[o + 3] = one;
    }
    // Ambiente em no máximo 1024 × 512: o PMREM fica com 256 px por face, igual ao do céu procedural,
    // e a troca não obriga o three a recompilar os shaders da cena
    let ew = w, eh = h, envOut = env;
    if (w > 1024) {
      ew = w / 2; eh = h / 2; envOut = new Uint16Array(ew * eh * 4);
      const half = new Float32Array(env.length);
      for (let i = 0; i < env.length; i++) half[i] = fromHalf(env[i]);
      for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) for (let c = 0; c < 4; c++) {
        const a = (k, j) => half[((2 * y + j) * w + 2 * x + k) * 4 + c];
        envOut[(y * ew + x) * 4 + c] = toHalf((a(0, 0) + a(1, 0) + a(0, 1) + a(1, 1)) / 4);
      }
    }
    postMessage({ id, w, h, full, ew, eh, env: envOut, horizon: hz }, [full.buffer, envOut.buffer]);
  } catch (err) { postMessage({ id, error: String(err) }); }
};
