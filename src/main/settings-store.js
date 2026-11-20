// Persistencia sencilla en JSON dentro de la carpeta de datos del usuario.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  petName: 'Thomas',
  petScale: 1.0,          // tamaño en pantalla
  activity: 0.5,          // 0 = tranquilo, 1 = hiperactivo
  volume: 0.6,
  meowIntervalMin: 5,     // minutos de media entre maullidos (0 = nunca)
  windowInteraction: true,
  displayId: null,        // null = pantalla principal
  launchAtLogin: false,
  activeAvatar: 'default',
  // Maullidos incluidos que NO se usan (se eligen en Ajustes > Sonido).
  mutedSounds: [],
  cutoutQuality: 'high',  // 'high' (isnet, ~170 MB) | 'fast' (u2netp, ~5 MB)
};

class JsonFile {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = { ...defaults };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { /* primera ejecución o fichero corrupto: se usan los valores por defecto */ }
  }

  get(key) { return key ? this.data[key] : this.data; }

  set(patch) {
    Object.assign(this.data, patch);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonFile, DEFAULTS };
