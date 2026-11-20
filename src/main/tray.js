// Icono de la bandeja del sistema. El icono se dibuja por código para no depender de assets.
const { Tray, Menu, nativeImage } = require('electron');
const { encodePNG } = require('./pipeline/png');

function drawIcon(size = 32) {
  const rgba = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b) => {
    const i = (y * size + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  };
  const u = size / 32;
  const inTri = (px, py, [ax, ay, bx, by, cx, cy]) => {
    const d = (x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
    const d1 = d(ax, ay, bx, by), d2 = d(bx, by, cx, cy), d3 = d(cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / u, py = y / u;
      const head = (px - 16) ** 2 + (py - 19) ** 2 <= 11.5 ** 2;
      const ears = inTri(px, py, [5, 14, 7, 2, 15, 9]) || inTri(px, py, [27, 14, 25, 2, 17, 9]);
      if (!head && !ears) continue;
      const eye = (px - 11.5) ** 2 + (py - 18) ** 2 <= 4 || (px - 20.5) ** 2 + (py - 18) ** 2 <= 4;
      const nose = (px - 16) ** 2 + (py - 22.5) ** 2 <= 2;
      if (eye) put(x, y, 58, 42, 32);
      else if (nose) put(x, y, 255, 143, 163);
      else put(x, y, 242, 166, 90);
    }
  }
  return nativeImage.createFromBuffer(encodePNG({ rgba, w: size, h: size }));
}

function createTray({ getName, onSettings, onAction, onToggle, isVisible, onQuit }) {
  const tray = new Tray(drawIcon(32));
  const rebuild = () => {
    tray.setToolTip(`${getName()} · ThomasForever`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Ajustes…', click: onSettings },
      { type: 'separator' },
      { label: 'Acariciar', click: () => onAction('pet') },
      { label: 'Dar de comer', click: () => onAction('feed') },
      { label: 'Llamar (maullar)', click: () => onAction('meow') },
      { label: isVisible() ? 'Ocultar mascota' : 'Mostrar mascota', click: () => { onToggle(); rebuild(); } },
      { type: 'separator' },
      { label: 'Salir', click: onQuit },
    ]));
  };
  rebuild();
  tray.on('double-click', onSettings);
  return { tray, rebuild };
}

module.exports = { createTray, drawIcon };
