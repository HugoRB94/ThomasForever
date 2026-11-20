// Recorte automático del fondo, 100 % local: modelo de segmentación ONNX ejecutado en CPU.
// El modelo se descarga una sola vez a la carpeta de datos del usuario.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { net, utilityProcess } = require('electron');
const { nativeToRGBA, transparentFraction, cropToAlpha } = require('./png');

const RELEASES = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/';
const MODELS = {
  fast: {
    file: 'u2netp.onnx', size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], mb: 5,
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  },
  high: {
    file: 'isnet-general-use.onnx', size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1], mb: 170,
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
  },
};
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

// El modelo se descarga de internet: antes de usarlo se comprueba que es exactamente el
// archivo esperado (huella SHA-256), para no ejecutar un modelo dañado o manipulado.
const verified = new Set();
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const part of fs.createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}

// La inferencia corre en un proceso auxiliar que se cierra tras unos segundos sin uso:
// así el modelo (cientos de MB en RAM) no se queda residente junto a la mascota.
let worker = null;
let idleTimer = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = utilityProcess.fork(path.join(__dirname, 'ort-worker.js'), [], { serviceName: 'ThomasForever · recorte' });
  const current = worker;
  current.on('message', ({ id, mask, error }) => {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (error) job.reject(new Error(error)); else job.resolve(mask);
  });
  current.on('exit', () => {
    if (worker === current) worker = null;
    for (const job of pending.values()) job.reject(new Error('El proceso de recorte se ha cerrado inesperadamente'));
    pending.clear();
  });
  return worker;
}

function runModel(modelPath, input, size) {
  clearTimeout(idleTimer);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, modelPath, input, size });
  }).finally(() => {
    if (pending.size) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (worker && !pending.size) worker.kill(); }, 15000);
  });
}

async function ensureModel(key, dir, onProgress) {
  const m = MODELS[key];
  const dest = path.join(dir, m.file);
  if (fs.existsSync(dest)) {
    if (verified.has(dest) || (await sha256(dest)) === m.sha256) { verified.add(dest); return dest; }
    await fsp.rm(dest, { force: true }); // no coincide: se descarga de nuevo
  }
  await fsp.mkdir(dir, { recursive: true });
  onProgress?.(`Descargando modelo de recorte (${m.mb} MB, solo la primera vez)…`, 0);
  const res = await net.fetch(RELEASES + m.file, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`No se pudo descargar el modelo (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || m.mb * 1e6;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0, lastPct = -1;
  for await (const part of res.body) {
    got += part.length;
    if (!out.write(part)) await once(out, 'drain');
    const pct = Math.floor((got / total) * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      onProgress?.(`Descargando modelo de recorte… ${pct} %`, got / total);
    }
  }
  out.end();
  await once(out, 'finish');
  if ((await sha256(tmp)) !== m.sha256) {
    await fsp.rm(tmp, { force: true });
    throw new Error('El modelo descargado no supera la comprobación de integridad');
  }
  await fsp.rename(tmp, dest);
  verified.add(dest);
  return dest;
}

// Filtro morfológico cuadrado (erosión o dilatación) de radio r sobre una máscara 0/1.
function morph(mask, w, h, r, erode) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const hit = erode ? 0 : 1; // valor que "gana" dentro de la ventana
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - hit;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (mask[y * w + k] === hit) { v = hit; break; }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - hit;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] === hit) { v = hit; break; }
      out[y * w + x] = v;
    }
  }
  return out;
}

// Limpia la máscara: elimina hebras finas (cables, patas de silla, sombras) y manchas
// sueltas, y se queda solo con la pieza más grande, que es la mascota.
function keepMainSubject(rgba, w, h) {
  const n = w * h;
  const r = Math.max(2, Math.round(Math.max(w, h) / 300)); // ~3 px a 1024
  let solid = new Uint8Array(n);
  for (let p = 0; p < n; p++) solid[p] = rgba[p * 4 + 3] > 127 ? 1 : 0;
  solid = morph(morph(solid, w, h, r, true), w, h, r, false); // apertura: fuera lo fino

  // Componentes conexas: se conserva la mayor.
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  let best = 0, bestSize = 0, current = 0;
  for (let p = 0; p < n; p++) {
    if (!solid[p] || label[p]) continue;
    current++;
    let top = 0, size = 0;
    stack[top++] = p;
    label[p] = current;
    while (top) {
      const q = stack[--top];
      size++;
      const x = q % w;
      if (x > 0 && solid[q - 1] && !label[q - 1]) { label[q - 1] = current; stack[top++] = q - 1; }
      if (x < w - 1 && solid[q + 1] && !label[q + 1]) { label[q + 1] = current; stack[top++] = q + 1; }
      if (q >= w && solid[q - w] && !label[q - w]) { label[q - w] = current; stack[top++] = q - w; }
      if (q < n - w && solid[q + w] && !label[q + w]) { label[q + w] = current; stack[top++] = q + w; }
    }
    if (size > bestSize) { bestSize = size; best = current; }
  }
  if (!best) return;

  // Se admite el borde suave (pelo) solo cerca de esa pieza.
  let keep = new Uint8Array(n);
  for (let p = 0; p < n; p++) keep[p] = label[p] === best ? 1 : 0;
  keep = morph(keep, w, h, r * 2 + 1, false);
  for (let p = 0; p < n; p++) if (!keep[p]) rgba[p * 4 + 3] = 0;
}

// img: nativeImage. Devuelve { rgba, w, h } recortado al sujeto, con alfa.
async function removeBackground(img, { quality = 'high', modelsDir, onProgress } = {}) {
  const src = nativeToRGBA(img);

  // Si la imagen ya trae transparencia (un PNG ya recortado), solo se ajusta al sujeto.
  if (transparentFraction(src) > 0.08) {
    const cropped = cropToAlpha(src);
    if (!cropped) throw new Error('La imagen está vacía');
    return cropped;
  }

  const key = MODELS[quality] ? quality : 'high';
  const m = MODELS[key];
  const modelPath = await ensureModel(key, modelsDir, onProgress);
  onProgress?.('Separando la mascota del fondo…');

  // Preprocesado: S×S, normalizado, formato NCHW.
  const S = m.size;
  const small = img.resize({ width: S, height: S, quality: 'best' }).toBitmap(); // BGRA
  let max = 1;
  for (let i = 0; i < small.length; i += 4) max = Math.max(max, small[i], small[i + 1], small[i + 2]);
  const plane = S * S;
  const input = new Float32Array(3 * plane);
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    input[p] = (small[i + 2] / max - m.mean[0]) / m.std[0];
    input[plane + p] = (small[i + 1] / max - m.mean[1]) / m.std[1];
    input[2 * plane + p] = (small[i] / max - m.mean[2]) / m.std[2];
  }

  const mask = await runModel(modelPath, input, S);
  let lo = Infinity, hi = -Infinity;
  for (let p = 0; p < plane; p++) { if (mask[p] < lo) lo = mask[p]; if (mask[p] > hi) hi = mask[p]; }
  const range = hi - lo || 1;

  // Máscara → alfa a resolución original (interpolación bilineal).
  const { rgba, w, h } = src;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(S - 1, Math.max(0, ((y + 0.5) * S) / h - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(S - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(S - 1, Math.max(0, ((x + 0.5) * S) / w - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(S - 1, x0 + 1), wx = fx - x0;
      const top = mask[y0 * S + x0] * (1 - wx) + mask[y0 * S + x1] * wx;
      const bot = mask[y1 * S + x0] * (1 - wx) + mask[y1 * S + x1] * wx;
      let a = ((top * (1 - wy) + bot * wy) - lo) / range;
      a = a < 0.06 ? 0 : a > 0.94 ? 1 : a; // limpia el ruido de fondo sin endurecer el pelo
      rgba[(y * w + x) * 4 + 3] = Math.round(a * 255);
    }
  }

  keepMainSubject(rgba, w, h);

  const cropped = cropToAlpha(src);
  if (!cropped || cropped.w < 24 || cropped.h < 24) {
    throw new Error('No se ha detectado ninguna mascota en la foto');
  }
  return cropped;
}

module.exports = { removeBackground, MODELS };
