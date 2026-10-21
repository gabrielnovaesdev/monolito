// Ferramenta offline: lê .hdr (RGBE), acha o sol (pixel mais brilhante), mede a cor do horizonte
// e grava uma versão reduzida pela metade (2K → 1K) para o celular.
// Uso: node hdr-tool.mjs entrada_2k.hdr [saida_1k.hdr]
import { readFileSync, writeFileSync } from 'node:fs';

function readHDR(buf) {
  let p = 0, line = '', w = 0, h = 0;
  while (true) {
    const c = buf[p++];
    if (c === 10) { const m = line.match(/^-Y (\d+) \+X (\d+)/); if (m) { h = +m[1]; w = +m[2]; break; } line = ''; } else line += String.fromCharCode(c);
  }
  const data = new Float32Array(w * h * 3), row = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[p] === 2 && buf[p + 1] === 2) {
      p += 4;
      for (let ch = 0; ch < 4; ch++) {
        let x = 0;
        while (x < w) {
          let n = buf[p++];
          if (n > 128) { n -= 128; const v = buf[p++]; while (n--) row[(x++) * 4 + ch] = v; } else while (n--) row[(x++) * 4 + ch] = buf[p++];
        }
      }
    } else { for (let x = 0; x < w; x++) for (let ch = 0; ch < 4; ch++) row[x * 4 + ch] = buf[p++]; }
    for (let x = 0; x < w; x++) {
      const e = row[x * 4 + 3], f = e ? Math.pow(2, e - 136) : 0, i = (y * w + x) * 3;
      data[i] = row[x * 4] * f; data[i + 1] = row[x * 4 + 1] * f; data[i + 2] = row[x * 4 + 2] * f;
    }
  }
  return { w, h, data };
}
function writeHDR({ w, h, data }) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'ascii');
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2], m = Math.max(r, g, b);
    if (m < 1e-32) continue;
    const e = Math.ceil(Math.log2(m)), s = 256 / Math.pow(2, e);
    out[i * 4] = Math.min(255, r * s); out[i * 4 + 1] = Math.min(255, g * s); out[i * 4 + 2] = Math.min(255, b * s); out[i * 4 + 3] = e + 128;
  }
  return Buffer.concat([head, out]);
}

const img = readHDR(readFileSync(process.argv[2]));
const { w, h, data } = img;
let best = 0, bi = 0;
for (let y = 0; y < h / 2; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3, l = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722; if (l > best) { best = l; bi = y * w + x; } }
const sx = bi % w, sy = Math.floor(bi / w);
// Mesma convenção do three (equirectUv): u = atan(z, x)/2π + 0.5 ; v = asin(y)/π + 0.5 ; linha 0 = topo
const u = (sx + 0.5) / w, v = 1 - (sy + 0.5) / h;
const az = (u - 0.5) * 2 * Math.PI, el = (v - 0.5) * Math.PI;
const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
// Cor média do céu logo acima do horizonte (faixa de 0° a 6°)
const acc = [0, 0, 0]; let n = 0;
for (let y = Math.floor(h * (0.5 - 6 / 180)); y < h / 2; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; acc[0] += data[i]; acc[1] += data[i + 1]; acc[2] += data[i + 2]; n++; }
console.log(JSON.stringify({ file: process.argv[2], w, h, sunPx: [sx, sy], sunLum: +best.toFixed(1), elevDeg: +(el * 180 / Math.PI).toFixed(1), azRad: +az.toFixed(3), dir: dir.map((x) => +x.toFixed(3)), horizon: acc.map((x) => +(x / n).toFixed(3)) }));

if (process.argv[3]) {
  const W = w / 2, H = h / 2, d2 = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    const a = (k, j) => data[((2 * y + j) * w + 2 * x + k) * 3 + c];
    d2[(y * W + x) * 3 + c] = (a(0, 0) + a(1, 0) + a(0, 1) + a(1, 1)) / 4;
  }
  writeFileSync(process.argv[3], writeHDR({ w: W, h: H, data: d2 }));
}
