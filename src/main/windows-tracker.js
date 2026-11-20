// Detección de ventanas del SO (Windows): enumera las ventanas visibles en orden Z y
// calcula qué tramos de su borde superior están a la vista. Esos tramos son las
// "plataformas" sobre las que la mascota puede subirse.
let api = null;

function loadApi() {
  if (api !== null) return api;
  if (process.platform !== 'win32') return (api = false);
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    koffi.struct('TF_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    api = {
      GetTopWindow: user32.func('intptr_t __stdcall GetTopWindow(intptr_t hWnd)'),
      GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t uCmd)'),
      IsWindowVisible: user32.func('int __stdcall IsWindowVisible(intptr_t hWnd)'),
      IsIconic: user32.func('int __stdcall IsIconic(intptr_t hWnd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(intptr_t hWnd)'),
      GetWindowLongW: user32.func('long __stdcall GetWindowLongW(intptr_t hWnd, int nIndex)'),
      GetWindowRect: user32.func('int __stdcall GetWindowRect(intptr_t hWnd, _Out_ TF_RECT *lpRect)'),
      DwmGetRect: dwmapi.func('DwmGetWindowAttribute', 'long', ['intptr_t', 'uint32_t', koffi.out(koffi.pointer('TF_RECT')), 'uint32_t']),
      DwmGetInt: dwmapi.func('DwmGetWindowAttribute', 'long', ['intptr_t', 'uint32_t', koffi.out(koffi.pointer('int')), 'uint32_t']),
    };
  } catch (err) {
    console.error('[windows-tracker] no disponible:', err.message);
    api = false;
  }
  return api;
}

const GW_HWNDNEXT = 2;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_TRANSPARENT = 0x20;
const WS_EX_NOACTIVATE = 0x08000000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;

// Ventanas de primer nivel "reales", de arriba a abajo en el orden Z, en píxeles físicos.
function listWindows(excludeHandles = []) {
  const a = loadApi();
  if (!a) return [];
  const exclude = new Set(excludeHandles.map(Number));
  const out = [];
  let guard = 0;
  for (let h = Number(a.GetTopWindow(0)); h && guard < 2000; h = Number(a.GetWindow(h, GW_HWNDNEXT)), guard++) {
    if (exclude.has(h)) continue;
    if (!a.IsWindowVisible(h) || a.IsIconic(h)) continue;
    const ex = a.GetWindowLongW(h, GWL_EXSTYLE) >>> 0;
    if (ex & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE)) continue;
    if (a.GetWindowTextLengthW(h) === 0) continue;
    const cloaked = [0];
    a.DwmGetInt(h, DWMWA_CLOAKED, cloaked, 4);
    if (cloaked[0]) continue; // escritorios virtuales, apps UWP suspendidas…
    const r = {};
    // Los límites de DWM excluyen la sombra invisible que sí incluye GetWindowRect.
    if (a.DwmGetRect(h, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0 && !a.GetWindowRect(h, r)) continue;
    const width = r.right - r.left, height = r.bottom - r.top;
    if (width < 120 || height < 60) continue;
    out.push({ id: h, x: r.left, y: r.top, width, height });
  }
  return out;
}

function isMinimized(id) {
  const a = loadApi();
  try { return !!(a && a.IsIconic(id)); } catch { return false; }
}

// rects: ventanas en orden Z (arriba → abajo) ya en coordenadas del overlay.
// Devuelve los tramos visibles del borde superior de cada una.
function computePlatforms(rects, areaWidth, areaHeight) {
  const platforms = [];
  rects.forEach((w, i) => {
    const y = w.y;
    if (y < 30 || y > areaHeight - 40) return;
    let segs = [[Math.max(w.x, 0), Math.min(w.x + w.width, areaWidth)]];
    for (let j = 0; j < i && segs.length; j++) {
      const o = rects[j];
      if (o.y > y + 1 || o.y + o.height <= y) continue; // no tapa esa línea
      const next = [];
      for (const [a, b] of segs) {
        const oa = o.x, ob = o.x + o.width;
        if (ob <= a || oa >= b) { next.push([a, b]); continue; }
        if (oa > a) next.push([a, oa]);
        if (ob < b) next.push([ob, b]);
      }
      segs = next;
    }
    for (const [a, b] of segs) {
      if (b - a >= 80) platforms.push({ win: w.id, x1: Math.round(a), x2: Math.round(b), y: Math.round(y), left: Math.round(w.x) });
    }
  });
  return platforms;
}

class WindowsTracker {
  // getContext() → { exclude: [hwnd…], bounds: {x,y,width,height} (DIP), toDip(rect) }
  // onGone([{ kind: 'minimize' | 'close', x, y, width, height }]): ventanas que han dejado de
  // estar a la vista, con el rectángulo que ocupaban (en coordenadas del overlay).
  constructor(getContext, onUpdate, onGone = null, intervalMs = 100) {
    this.getContext = getContext;
    this.onUpdate = onUpdate;
    this.onGone = onGone;
    this.known = null;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.last = '';
  }

  get available() { return !!loadApi(); }

  start() {
    if (this.timer || !this.available) return;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.last = '';
    this.known = null;
  }

  poll() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const { bounds } = ctx;
      const mapped = listWindows(ctx.exclude).map((w) => {
        const d = ctx.toDip({ x: w.x, y: w.y, width: w.width, height: w.height });
        return { id: w.id, x: d.x - bounds.x, y: d.y - bounds.y, width: d.width, height: d.height };
      });

      // ¿Alguna ventana que estaba a la vista ya no lo está? Se avisa con su último rectángulo.
      const now = new Map(mapped.map((w) => [w.id, w]));
      if (this.known && this.onGone) {
        const gone = [];
        for (const [id, w] of this.known) {
          if (!now.has(id)) gone.push({ kind: isMinimized(id) ? 'minimize' : 'close', x: w.x, y: w.y, width: w.width, height: w.height });
        }
        if (gone.length) this.onGone(gone);
      }
      this.known = now;

      const rects = mapped
        .filter((w) => w.x < bounds.width && w.x + w.width > 0 && w.y < bounds.height && w.y + w.height > 0);
      const platforms = computePlatforms(rects, bounds.width, bounds.height);
      const key = JSON.stringify(platforms);
      if (key !== this.last) {
        this.last = key;
        this.onUpdate(platforms);
      }
    } catch (err) {
      console.error('[windows-tracker]', err.message);
    }
  }
}

module.exports = { WindowsTracker, listWindows, computePlatforms };

// Prueba rápida: `node src/main/windows-tracker.js`
if (require.main === module) {
  const wins = listWindows();
  console.log(`${wins.length} ventanas (orden Z):`);
  for (const w of wins) console.log(' ', w);
  console.log('plataformas (suponiendo 1920x1040):', computePlatforms(wins, 1920, 1040));
}
