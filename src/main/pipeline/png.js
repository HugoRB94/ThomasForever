// Utilidades de imagen sin dependencias: codificador PNG (RGBA sin premultiplicar),
// recorte por alfa y reescalado.
const zlib = require('node:zlib');

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG({ rgba, w, h }) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// nativeImage de Electron → RGBA sin premultiplicar.
function nativeToRGBA(img) {
  const { width: w, height: h } = img.getSize();
  const bgra = img.toBitmap();
  if (bgra.length !== w * h * 4) throw new Error('Tamaño de bitmap inesperado');
  const rgba = Buffer.allocUnsafe(w * h * 4);
  for (let i = 0; i < bgra.length; i += 4) {
    const a = bgra[i + 3];
    let b = bgra[i], g = bgra[i + 1], r = bgra[i + 2];
    if (a > 0 && a < 255) { // el bitmap viene premultiplicado
      r = Math.min(255, Math.round((r * 255) / a));
      g = Math.min(255, Math.round((g * 255) / a));
      b = Math.min(255, Math.round((b * 255) / a));
    }
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  }
  return { rgba, w, h };
}

function transparentFraction({ rgba, w, h }) {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 16) n++;
  return n / (w * h);
}

// Recorta al rectángulo que contiene los píxeles visibles.
function cropToAlpha({ rgba, w, h }, pad = 4, threshold = 24) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  const out = Buffer.allocUnsafe(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    rgba.copy(out, y * nw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + nw) * 4);
  }
  return { rgba: out, w: nw, h: nh };
}

// Reducción por promedio de área (con alfa premultiplicado para no ensuciar los bordes).
function downscale({ rgba, w, h }, scale) {
  if (scale >= 1) return { rgba, w, h };
  const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
  const out = Buffer.alloc(nw * nh * 4);
  for (let dy = 0; dy < nh; dy++) {
    const sy0 = Math.floor((dy * h) / nh), sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * h) / nh));
    for (let dx = 0; dx < nw; dx++) {
      const sx0 = Math.floor((dx * w) / nw), sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * w) / nw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < h; sy++) {
        for (let sx = sx0; sx < sx1 && sx < w; sx++) {
          const i = (sy * w + sx) * 4, al = rgba[i + 3];
          r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; n++;
        }
      }
      const o = (dy * nw + dx) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = n ? Math.round(a / n) : 0;
    }
  }
  return { rgba: out, w: nw, h: nh };
}

module.exports = { encodePNG, nativeToRGBA, transparentFraction, cropToAlpha, downscale };
