// Avatar basado en imágenes: el recorte de una foto (una sola pose) o varias fotos de la
// mascota en distintas posturas. Misma interfaz que el avatar procedural.
/* global PIXI */
const { Container, Sprite, Texture } = PIXI;

const BASE_HEIGHT = 125; // alto en px de la pose base a escala 1

async function loadTexture(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return Texture.from(img);
}

// data: { manifest: { facing, frames }, frames: { nombre: dataURL } }
export async function createImageAvatar(data) {
  const textures = {};
  for (const [name, url] of Object.entries(data.frames)) textures[name] = await loadTexture(url);
  if (!textures.idle) throw new Error('El avatar no tiene pose base');

  const k = BASE_HEIGHT / textures.idle.height;       // escala común (poses sin altura propia)
  // Las poses hechas con fotos propias traen su altura relativa: se escalan una a una.
  const meta = data.manifest.frames;
  const scales = {};
  for (const name of Object.keys(textures)) {
    scales[name] = meta[name]?.rel ? (BASE_HEIGHT * meta[name].rel) / textures[name].height : k;
  }
  const flip = data.manifest.facing === 'left' ? -1 : 1; // el contenedor asume "mira a la derecha"
  const hasWalk = !!(textures.walk1 || textures.walk2);

  const root = new Container();
  const sprite = new Sprite(textures.idle);
  sprite.anchor.set(0.5, 1);
  root.addChild(sprite);

  const pick = (v) => {
    if (v.asleep && textures.sleep) return 'sleep';
    if (v.eating && textures.eat) return 'eat';
    if (v.meowing && textures.meow) return 'meow';
    if (v.happy && textures.happy) return 'happy';
    if (v.walking && hasWalk) {
      const a = textures.walk1 ? 'walk1' : 'walk2', b = textures.walk2 ? 'walk2' : 'walk1';
      return Math.floor(v.t / 0.17) % 2 ? a : b;
    }
    return 'idle';
  };
  const oneWalkFrame = hasWalk && !(textures.walk1 && textures.walk2);

  return {
    root,
    bounds: { halfW: Math.max(34, (textures.idle.width * k) / 2 * 0.85), h: BASE_HEIGHT },
    sleepSquash: textures.sleep ? 0 : 0.16,
    update(v) {
      const name = pick(v);
      const tex = textures[name];
      if (sprite.texture !== tex) sprite.texture = tex;
      sprite.scale.set(scales[name] * flip, scales[name]);

      // Con una sola foto no hay patas que mover: se le da vida balanceándola desde la base.
      let sway = Math.sin(v.t * 1.6) * 0.015;
      let rock = 0;
      if (v.walking && !hasWalk) rock = Math.sin(v.t * 12) * 0.07;
      if (v.walking && oneWalkFrame) rock = Math.sin(v.t * 12) * 0.035; // un solo fotograma: leve vaivén
      if (v.happy) sway += Math.sin(v.t * 22) * 0.03;
      if (v.eating && !textures.eat) rock = 0.22 + Math.sin(v.t * 20) * 0.04;
      sprite.skew.x = sway;
      sprite.rotation = rock;
      sprite.tint = v.asleep && !textures.sleep ? 0xc9c9dd : 0xffffff;
    },
    destroy() {
      root.destroy({ children: true });
      for (const t of Object.values(textures)) t.destroy(true);
    },
  };
}
