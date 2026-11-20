// npm puede bloquear los scripts de instalación de dependencias; si el binario de
// Electron no se ha descargado, se lanza aquí su instalador.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, '..', 'node_modules', 'electron');
if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, 'path.txt'))) {
  console.log('Descargando el binario de Electron…');
  const res = spawnSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
  process.exit(res.status ?? 0);
}
