// Audios personalizados del usuario: se copian a <userData>/sounds/.
const fs = require('node:fs');
const path = require('node:path');
const { dialog } = require('electron');

const EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm'];
const MAX_BYTES = 20 * 1024 * 1024;

class SoundStore {
  constructor(dir) { this.dir = dir; }

  file(name) { return path.join(this.dir, path.basename(String(name))); }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter((f) => EXTENSIONS.includes(path.extname(f).slice(1).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  }

  async addWithDialog(parentWindow) {
    const res = await dialog.showOpenDialog(parentWindow, {
      title: 'Añadir sonidos de tu mascota',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: EXTENSIONS }],
    });
    if (res.canceled) return { added: 0, skipped: [] };
    fs.mkdirSync(this.dir, { recursive: true });
    let added = 0;
    const skipped = [];
    for (const src of res.filePaths) {
      const ext = path.extname(src).slice(1).toLowerCase();
      if (!EXTENSIONS.includes(ext) || fs.statSync(src).size > MAX_BYTES) { skipped.push(path.basename(src)); continue; }
      fs.copyFileSync(src, this.file(src));
      added++;
    }
    return { added, skipped };
  }

  // Solo se puede leer o borrar un audio que esté en la lista: nada de rutas arbitrarias.
  existing(name) {
    const base = path.basename(String(name));
    if (!this.list().includes(base)) throw new Error('Ese audio no existe');
    return path.join(this.dir, base);
  }

  remove(name) { fs.rmSync(this.existing(name), { force: true }); }

  read(name) { return fs.readFileSync(this.existing(name)); }
}

module.exports = { SoundStore };
