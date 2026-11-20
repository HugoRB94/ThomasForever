// Almacén de avatares: cada uno vive en <userData>/avatars/<id>/ con un manifest.json,
// y un PNG recortado por pose.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { nativeImage } = require('electron');
const { removeBackground } = require('./pipeline/cutout');
const { encodePNG, downscale } = require('./pipeline/png');

const MAX_SOURCE = 1024; // lado máximo de la foto que se conserva
const MAX_FRAME = 512;   // lado máximo del sprite

// Poses admitidas y su altura relativa respecto a la pose base (sentado). Las fotos
// propias vienen cada una con su encuadre, así que cada pose se escala por separado.
const POSES = {
  idle: { label: 'Sentado (base)', rel: 1 },
  walk1: { label: 'Caminando', rel: 0.8 },
  walk2: { label: 'Caminando (2)', rel: 0.8 },
  sleep: { label: 'Durmiendo', rel: 0.5 },
  eat: { label: 'Comiendo', rel: 0.75 },
  happy: { label: 'Contento', rel: 1 },
  meow: { label: 'Maullando', rel: 1 },
};

class AvatarStore {
  constructor(baseDir, modelsDir) {
    this.baseDir = baseDir;
    this.modelsDir = modelsDir;
  }

  dir(id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Identificador de avatar no válido');
    return path.join(this.baseDir, id);
  }

  readManifest(id) {
    return JSON.parse(fs.readFileSync(path.join(this.dir(id), 'manifest.json'), 'utf8'));
  }

  writeManifest(manifest) {
    fs.writeFileSync(path.join(this.dir(manifest.id), 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  frameDataUrl(id, file) {
    const buf = fs.readFileSync(path.join(this.dir(id), path.basename(file)));
    return 'data:image/png;base64,' + buf.toString('base64');
  }

  list() {
    if (!fs.existsSync(this.baseDir)) return [];
    const out = [];
    for (const id of fs.readdirSync(this.baseDir)) {
      try {
        const m = this.readManifest(id);
        out.push({
          id: m.id, name: m.name, type: m.type, facing: m.facing, createdAt: m.createdAt,
          poses: Object.keys(m.frames),
          thumb: this.frameDataUrl(id, m.frames.idle.file),
        });
      } catch { /* carpeta incompleta: se ignora */ }
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  // Todo lo que necesita el renderer para dibujar el avatar.
  get(id) {
    try {
      const manifest = this.readManifest(id);
      const frames = {};
      for (const [name, f] of Object.entries(manifest.frames)) frames[name] = this.frameDataUrl(id, f.file);
      return { manifest, frames };
    } catch {
      return null;
    }
  }

  // input: { path } o { dataURL } → nativeImage reducida
  loadImage(input) {
    let img = input.path ? nativeImage.createFromPath(input.path) : nativeImage.createFromDataURL(input.dataURL);
    if (img.isEmpty()) throw new Error('No se ha podido leer la imagen (usa JPG o PNG)');
    const size = img.getSize();
    const k = Math.min(1, MAX_SOURCE / Math.max(size.width, size.height));
    if (k < 1) img = img.resize({ width: Math.round(size.width * k), height: Math.round(size.height * k), quality: 'best' });
    return img;
  }

  async cutFrame(img, quality, onProgress) {
    const cut = await removeBackground(img, { quality, modelsDir: this.modelsDir, onProgress });
    return downscale(cut, MAX_FRAME / Math.max(cut.w, cut.h));
  }

  // Añade o sustituye una pose de un avatar a partir de una foto propia.
  async setPose(id, pose, input, quality, onProgress) {
    if (!Object.hasOwn(POSES, pose)) throw new Error('Pose desconocida');
    const manifest = this.readManifest(id);
    const img = this.loadImage(input);
    const frame = await this.cutFrame(img, quality, onProgress);
    const previous = manifest.frames[pose]?.file;
    const file = `pose-${pose}-${Date.now().toString(36)}.png`;
    await fsp.writeFile(path.join(this.dir(id), file), encodePNG(frame));
    manifest.frames[pose] = { file, w: frame.w, h: frame.h, rel: POSES[pose].rel };
    manifest.type = Object.keys(manifest.frames).length > 1 ? 'photos' : 'photo';
    this.writeManifest(manifest);
    if (previous && previous !== file) fs.rmSync(path.join(this.dir(id), path.basename(previous)), { force: true });
    return manifest;
  }

  removePose(id, pose) {
    if (!Object.hasOwn(POSES, pose)) throw new Error('Pose desconocida');
    if (pose === 'idle') throw new Error('La pose base no se puede quitar');
    const manifest = this.readManifest(id);
    const frame = manifest.frames[pose];
    if (!frame) return manifest;
    delete manifest.frames[pose];
    if (manifest.type === 'photos' && Object.keys(manifest.frames).length === 1) manifest.type = 'photo';
    this.writeManifest(manifest);
    fs.rmSync(path.join(this.dir(id), path.basename(frame.file)), { force: true });
    return manifest;
  }

  async importPhoto(input, name, quality, onProgress) {
    const img = this.loadImage(input);
    const frame = await this.cutFrame(img, quality, onProgress);

    onProgress?.('Guardando avatar…');
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    await fsp.mkdir(this.dir(id), { recursive: true });
    await fsp.writeFile(path.join(this.dir(id), 'idle.png'), encodePNG(frame));
    const manifest = {
      id,
      name: String(name || 'Mi mascota').slice(0, 40),
      type: 'photo',
      facing: 'right',
      createdAt: Date.now(),
      frames: { idle: { file: 'idle.png', w: frame.w, h: frame.h, rel: 1 } },
    };
    this.writeManifest(manifest);
    return manifest;
  }

  update(id, patch) {
    const manifest = this.readManifest(id);
    if (typeof patch.name === 'string' && patch.name.trim()) manifest.name = patch.name.trim().slice(0, 40);
    if (patch.facing === 'left' || patch.facing === 'right') manifest.facing = patch.facing;
    this.writeManifest(manifest);
    return manifest;
  }

  remove(id) {
    fs.rmSync(this.dir(id), { recursive: true, force: true });
  }
}

module.exports = { AvatarStore, POSES };
