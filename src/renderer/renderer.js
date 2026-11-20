// Overlay de la mascota: bucle principal, comportamiento e interacción con el ratón.
/* global PIXI */
import { Fx, NeedsHud } from './fx.js';
import { Needs } from './pet/needs.js';
import { stepBody, jumpVelocity, GRAVITY } from './pet/physics.js';
import { PetAudio } from './audio/audio.js';
import { createProceduralAvatar } from './avatar/procedural.js';
import { createImageAvatar } from './avatar/image.js';

const { Application, Container, Graphics, Text } = PIXI;
const tf = window.tf;

const cfg = { scale: 1, activity: 0.5, windowInteraction: true, meowIntervalMin: 5, debug: false };
const WALK_SPEED = 90;
const PET_THRESHOLD = 160; // px de movimiento del ratón sobre la mascota = 1 caricia
const FOODS = ['🐟', '🍗', '🥩', '🧀'];

const app = new Application();
await app.init({
  backgroundAlpha: 0,
  resizeTo: window,
  antialias: true,
  autoDensity: true,
  resolution: window.devicePixelRatio || 1,
});
document.body.appendChild(app.canvas);

// ---------- Capas ----------
const debugLayer = new Graphics();
const petLayer = new Container();
const fx = new Fx();
const hud = new NeedsHud();
app.stage.addChild(debugLayer, petLayer, fx.layer, hud.root);

// ---------- Estado ----------
const audio = new PetAudio(tf);
const needs = new Needs();
const world = { floor: app.screen.height, platforms: [] };
const pet = {
  x: app.screen.width * 0.5, y: -50, vx: 0, vy: 0, dropT: 0,
  dir: 1, state: 'idle', timer: 1, onGround: false, support: null, leaving: false,
  squash: 0, happy: 0, petMeter: 0, t: 0, hoverT: 0,
};
const mouse = { x: -1, y: -1, px: -1, py: -1, vx: 0, vy: 0, time: 0 };
let avatar = createProceduralAvatar();
petLayer.addChild(avatar.root);
let drag = null;      // 'pet' | 'food' | null
let overTarget = false;
let food = null;      // { t, x, y, vx, vy, landed, held }
let meowTimer = 20;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const topOfPet = () => pet.y - avatar.bounds.h * cfg.scale;

function hitPet(mx, my) {
  const s = cfg.scale;
  return Math.abs(mx - pet.x) < avatar.bounds.halfW * s && my < pet.y + 4 && my > pet.y - (avatar.bounds.h + 6) * s;
}
const hitFood = (mx, my) => !!food && Math.hypot(mx - food.x, my - food.y) < 28;

function setState(state, seconds) {
  pet.sentToBed = false;
  pet.state = state;
  pet.timer = seconds;
}

function speak(emoji, name) {
  audio.meow(name);
  pet.meowT = 1.3; // mientras maúlla se muestra la pose "maullando", si existe
  if (emoji) fx.emit(emoji, pet.x + 40 * cfg.scale * pet.dir, topOfPet() - 6, 24);
}

// Una caricia: se pone contenta, sube el cariño y se despierta. No suena: el ronroneo
// queda reservado a la opción "Acariciar" del menú.
function stroke() {
  pet.happy = 1.5;
  needs.stroke();
  if (pet.state === 'sleep') setState('idle', 2);
  fx.emit('❤', pet.x + rand(-30, 30), topOfPet());
}

function scheduleMeow() {
  meowTimer = cfg.meowIntervalMin > 0 ? cfg.meowIntervalMin * 60 * rand(0.5, 1.5) : Infinity;
}

// ---------- Ajustes y avatar ----------
function applySettings(s) {
  cfg.scale = s.petScale;
  cfg.activity = s.activity;
  cfg.debug = s.debug;
  const freqChanged = cfg.meowIntervalMin !== s.meowIntervalMin;
  cfg.meowIntervalMin = s.meowIntervalMin;
  cfg.windowInteraction = s.windowInteraction;
  audio.setVolume(s.volume);
  audio.muted = new Set(s.mutedSounds || []);
  if (freqChanged) scheduleMeow();
  if (cfg.debug) window.__tf = { app, pet, needs, world, cfg, audio, tryJump, get food() { return food; }, get avatar() { return avatar; } };
  else debugLayer.clear();
}

async function loadAvatar() {
  let next;
  try {
    const data = await tf.getActiveAvatar();
    next = data ? await createImageAvatar(data) : createProceduralAvatar();
  } catch (err) {
    console.error('no se pudo cargar el avatar:', err.message);
    next = createProceduralAvatar();
  }
  petLayer.removeChild(avatar.root);
  avatar.destroy();
  avatar = next;
  petLayer.addChild(avatar.root);
  pet.happy = 1.5;
}

// ---------- Ventanas del SO → plataformas ----------
function startle() {
  pet.support = null;
  pet.onGround = false;
  pet.vy = -620;
  pet.vx = rand(-120, 120);
  setState('jump', 4);
  fx.emit('❗', pet.x, topOfPet() - 10, 28);
  audio.meow();
}

function onWindows(platforms) {
  world.platforms = platforms;
  if (drag === 'pet' || !pet.support || pet.support === 'floor') return;
  const segs = platforms.filter((p) => p.win === pet.support.win);
  if (!segs.length) return startle(); // la ventana se ha cerrado, minimizado o tapado
  // La ventana se ha movido: la mascota viaja con ella.
  pet.x += segs[0].left - pet.support.left;
  const seg = segs.find((p) => pet.x >= p.x1 && pet.x <= p.x2);
  if (!seg) { pet.support = null; pet.onGround = false; return; }
  pet.y = seg.y;
  pet.support = { win: seg.win, left: seg.left, seg };
}

// Has minimizado o cerrado una ventana: la mascota salta hacia el botón correspondiente
// de esa ventana (— o ✕), como si lo hubiera pulsado ella.
const CAPTION_BUTTON = { minimize: 115, close: 23 }; // distancia del botón al borde derecho

function onWindowGone(gone) {
  if (!cfg.windowInteraction || drag === 'pet' || !pet.onGround || !gone?.length) return;
  if (pet.state === 'jump' || pet.state === 'eat' || (pet.state === 'sleep' && pet.sentToBed)) return;
  const s = cfg.scale;
  const win = gone.find((w) => w.kind === 'minimize') || gone[0];
  const margin = avatar.bounds.halfW * s;
  const bx = clamp(win.x + win.width - CAPTION_BUTTON[win.kind], margin, app.screen.width - margin);
  const by = Math.max(win.y + 16, 8);

  // Salto cuyo punto más alto deja la cabeza de la mascota justo en el botón.
  const apexY = by + avatar.bounds.h * s * 0.85;
  const rise = Math.max(pet.y - apexY, 70);
  const vy0 = Math.sqrt(2 * GRAVITY * rise);
  const vx = clamp((bx - pet.x) / (vy0 / GRAVITY), -2600, 2600);

  pet.onGround = false;
  pet.support = null;
  pet.vy = -vy0;
  pet.vx = vx;
  if (Math.abs(vx) > 20) pet.dir = vx > 0 ? 1 : -1;
  pet.squash = -0.2;
  pet.poke = { x: bx, y: by, kind: win.kind };
  setState('jump', 5);
}

// ---------- Comida ----------
function spawnFood(x, y) {
  if (food) return;
  const t = new Text({ text: FOODS[Math.floor(Math.random() * FOODS.length)], style: { fontSize: 30 } });
  t.anchor.set(0.5);
  fx.layer.addChild(t);
  food = { t, x, y, vx: 0, vy: 0, dropT: 0, landed: false, held: false };
}

function removeFood() {
  if (!food) return;
  fx.layer.removeChild(food.t);
  food.t.destroy();
  food = null;
}

function startEating() {
  pet.dir = food.x >= pet.x ? 1 : -1;
  pet.vx = 0;
  if (pet.state !== 'eat') {
    setState('eat', 1.5);
    audio.chomp();
  }
}

function finishEating() {
  removeFood();
  needs.feed();
  pet.happy = 2;
  for (let i = 0; i < 3; i++) fx.emit('❤', pet.x + (i - 1) * 24, topOfPet());
  setState('idle', 1.5);
}

// ---------- Cerebro ----------
function tryJump() {
  const s = cfg.scale;
  const options = world.platforms.filter((p) => p.x2 - p.x1 >= 140 && p.y > avatar.bounds.h * s * 0.8 && Math.abs(p.y - pet.y) > 30);
  if (pet.support !== 'floor') options.push(null); // bajar al suelo
  if (!options.length) return false;
  const p = options[Math.floor(Math.random() * options.length)];

  if (p === null) {
    pet.dropT = 0.3;
    pet.vy = -320;
    pet.vx = pet.dir * 140;
  } else {
    const tx = clamp(pet.x + rand(-380, 380), p.x1 + 50, p.x2 - 50);
    const v = jumpVelocity(pet.x, pet.y, tx, p.y, rand(60, 110));
    if (!v) return false;
    pet.vx = v.vx;
    pet.vy = v.vy;
    pet.dir = v.vx >= 0 ? 1 : -1;
  }
  pet.onGround = false;
  pet.support = null;
  pet.squash = -0.18; // se estira al despegar
  setState('jump', 4);
  return true;
}

function think() {
  pet.leaving = false;
  if (food && !food.held) return setState('walk', 0.4);
  if (needs.energy < 15) return setState('sleep', rand(25, 45));
  if (needs.food < 25 && Math.random() < 0.45) { speak('🍗'); return setState('idle', 3); }
  if (needs.love < 25 && Math.random() < 0.35) { speak('🥺'); return setState('idle', 3); }

  const a = cfg.activity;
  const r = Math.random();
  if (cfg.windowInteraction && r < 0.18 + a * 0.3 && tryJump()) return undefined;
  if (r < 0.3 + a * 0.45) {
    pet.dir = Math.random() < 0.5 ? -1 : 1;
    return setState('walk', rand(1.5, 4.5));
  }
  if (r > 0.94 + a * 0.05 || (needs.energy < 40 && r > 0.8)) return setState('sleep', rand(10, 25));
  return setState('idle', rand(1, 4 - a * 2));
}

function brainStep(dt) {
  const s = cfg.scale;
  pet.timer -= dt;

  if (pet.state === 'eat') {
    pet.vx = 0;
    if (!food) setState('idle', 0.5);
    else if (pet.timer <= 0) finishEating();
    return;
  }
  if (pet.state === 'jump') setState('idle', 0.6); // acaba de aterrizar
  // Se despierta sola al recuperar la energía, salvo que la hayan mandado a dormir.
  if (pet.state === 'sleep' && needs.energy >= 99 && !pet.sentToBed) setState('idle', 1);
  if (pet.timer <= 0) think();
  if (!pet.onGround) return; // think() ha decidido saltar

  if (pet.state === 'walk') {
    if (food && !food.held) {
      const dx = food.x - pet.x;
      pet.dir = dx >= 0 ? 1 : -1;
      if (Math.abs(dx) < 36 * s) {
        pet.vx = 0;
        if (food.landed && Math.abs(food.y - pet.y) < 40) startEating();
        else if (food.y > pet.y + 40 && pet.support !== 'floor') pet.dropT = 0.25; // la comida está debajo
        return;
      }
    } else if (pet.support && pet.support !== 'floor' && !pet.leaving) {
      // En el borde de una ventana: casi siempre se da la vuelta, a veces se tira.
      const p = pet.support.seg;
      const nx = pet.x + pet.dir * 22;
      if (nx < p.x1 + 8 || nx > p.x2 - 8) {
        if (Math.random() < 0.7) pet.dir *= -1; else pet.leaving = true;
      }
    }
    pet.vx = pet.dir * WALK_SPEED * (food ? 2.2 : 1) * (0.6 + cfg.activity);
  } else {
    pet.vx *= Math.exp(-10 * dt); // fricción
  }
}

// ---------- Bucle principal ----------
app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 0.1);
  const s = cfg.scale;
  pet.t += dt;
  world.floor = app.screen.height;
  if (pet.dropT > 0) pet.dropT -= dt;

  if (drag === 'pet') {
    pet.poke = null;
    pet.x = mouse.x;
    pet.y = mouse.y + avatar.bounds.h * s * 0.5;
    pet.vx = mouse.vx;
    pet.vy = mouse.vy;
    pet.onGround = false;
    pet.support = null;
  } else {
    // En el aire se integra en pasos cortos: así los saltos son precisos aunque el
    // fotograma sea largo (p. ej. al salir del modo de bajo consumo).
    let res, left = dt;
    do {
      const h = pet.onGround ? left : Math.min(left, 1 / 120);
      res = stepBody(pet, h, world, cfg.windowInteraction);
      left -= h;
    } while (left > 1e-5 && !res.landed);
    if (pet.poke && pet.vy >= 0) {
      fx.emit(pet.poke.kind === 'minimize' ? '➖' : '✖', pet.poke.x, pet.poke.y, 22);
      fx.emit('✨', pet.poke.x + 14, pet.poke.y + 10, 20);
      audio.tap();
      pet.pokedAt = { x: Math.round(pet.x), top: Math.round(topOfPet()) }; // para depuración
      pet.vx *= 0.25;
      pet.poke = null;
    }
    if (res.landed) {
      if (res.impact > 500) pet.squash = Math.min(res.impact / 2500, 0.45);
      pet.onGround = true;
      pet.support = res.landed.kind === 'floor' ? 'floor' : { win: res.landed.p.win, left: res.landed.p.left, seg: res.landed.p };
    } else {
      pet.onGround = false;
      pet.support = null;
    }
    // Bordes de pantalla
    const margin = avatar.bounds.halfW * s;
    if (pet.x < margin) { pet.x = margin; pet.vx = Math.abs(pet.vx) * 0.5; pet.dir = 1; }
    if (pet.x > app.screen.width - margin) { pet.x = app.screen.width - margin; pet.vx = -Math.abs(pet.vx) * 0.5; pet.dir = -1; }

    if (pet.onGround) brainStep(dt);
  }

  const asleep = pet.state === 'sleep' && pet.onGround && drag !== 'pet';
  const walking = pet.state === 'walk' && pet.onGround && drag !== 'pet';
  const eating = pet.state === 'eat';
  needs.update(dt, asleep, cfg.activity);

  // Comida
  if (food) {
    if (food.held) {
      food.x = mouse.x; food.y = mouse.y;
    } else if (!food.landed) {
      const res = stepBody(food, dt, { floor: world.floor - 16, platforms: [] }, false);
      food.x = clamp(food.x, 20, app.screen.width - 20);
      if (res.landed) { food.landed = true; food.vx = 0; }
    }
    food.t.position.set(food.x, food.y);
    food.t.scale.set(eating ? clamp(pet.timer / 1.5, 0.15, 1) : 1);
  }

  // Maullidos espontáneos
  meowTimer -= dt;
  if (meowTimer <= 0) {
    scheduleMeow();
    if (!asleep && drag !== 'pet') speak('♪');
  }

  // ---------- Animación ----------
  pet.meowT = Math.max((pet.meowT || 0) - dt, 0);
  pet.squash *= Math.exp(-9 * dt);
  pet.happy = Math.max(pet.happy - dt, 0);
  const breathe = Math.sin(pet.t * (asleep ? 1.5 : 3)) * 0.02;
  const bob = walking ? Math.abs(Math.sin(pet.t * 12)) * 5 : 0;
  const wiggle = pet.happy > 0 && !asleep ? Math.sin(pet.t * 30) * 0.05 : 0;
  const sq = pet.squash + (asleep ? avatar.sleepSquash : 0);

  avatar.update({ t: pet.t, dt, asleep, walking, eating, meowing: pet.meowT > 0, happy: pet.happy > 0, dragging: drag === 'pet', airborne: !pet.onGround });
  avatar.root.position.set(pet.x, pet.y - bob * s);
  avatar.root.scale.set(pet.dir * s * (1 + sq * 0.6), s * (1 - sq + breathe));
  avatar.root.rotation = drag === 'pet' ? clamp(pet.vx / 2500, -0.5, 0.5) : wiggle;

  if (asleep && Math.random() < dt * 0.6) fx.emit('💤', pet.x + 40 * s * pet.dir, topOfPet() + 10, 20);
  fx.update(dt);

  pet.hoverT = overTarget && !drag && hitPet(mouse.x, mouse.y) ? pet.hoverT + dt : 0;
  // Encima de la mascota; si no cabe (está en lo alto de la pantalla), a un lado.
  let hudX = pet.x, hudY = topOfPet() - 74;
  if (hudY < 12) {
    hudX += (avatar.bounds.halfW * s + 74) * (pet.x > app.screen.width / 2 ? -1 : 1);
    hudY = Math.max(16, topOfPet() + 12);
  }
  hud.update(dt, pet.hoverT > 0.5, hudX, hudY, needs);

  // En reposo no hace falta redibujar 60 veces por segundo: se baja el ritmo para que la
  // mascota apenas gaste CPU/GPU mientras está quieta o dormida.
  const lively = !!drag || !pet.onGround || walking || eating || !!food || (fx.particles.length > 0 && !asleep)
    || pet.happy > 0 || pet.meowT > 0 || Math.abs(pet.squash) > 0.01 || Math.abs(pet.vx) > 5 || hud.root.visible;
  app.ticker.maxFPS = lively ? 60 : asleep ? 12 : 20;

  if (cfg.debug) {
    debugLayer.clear();
    for (const p of world.platforms) debugLayer.moveTo(p.x1, p.y).lineTo(p.x2, p.y).stroke({ color: 0xff2bd6, width: 3 });
  }
});

// ---------- Ratón + click-through ----------
function refreshHover() {
  const over = !!drag || hitPet(mouse.x, mouse.y) || hitFood(mouse.x, mouse.y);
  if (over !== overTarget) {
    overTarget = over;
    tf.setIgnoreMouse(!over); // en las zonas vacías los clics pasan al escritorio
    document.body.classList.toggle('over-pet', over);
  }
}

window.addEventListener('mousemove', (e) => {
  const now = performance.now();
  const dtm = Math.max((now - (mouse.time || now)) / 1000, 0.001);
  mouse.px = mouse.x; mouse.py = mouse.y;
  mouse.x = e.clientX; mouse.y = e.clientY;
  mouse.time = now;
  if (mouse.px >= 0) {
    // Velocidad suavizada: la hereda lo que se suelte (lanzamiento).
    mouse.vx = mouse.vx * 0.6 + ((mouse.x - mouse.px) / dtm) * 0.4;
    mouse.vy = mouse.vy * 0.6 + ((mouse.y - mouse.py) / dtm) * 0.4;
  }
  refreshHover();

  // Caricias: mover el ratón sobre la mascota sin pulsar.
  if (!drag && mouse.px >= 0 && hitPet(mouse.x, mouse.y)) {
    pet.petMeter += Math.hypot(mouse.x - mouse.px, mouse.y - mouse.py);
    if (pet.petMeter > PET_THRESHOLD) {
      pet.petMeter = 0;
      stroke();
    }
  }
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  audio.ensure();
  if (hitFood(e.clientX, e.clientY)) {
    drag = 'food';
    food.held = true;
    food.landed = false;
    if (pet.state === 'eat') setState('idle', 0.5);
  } else if (hitPet(e.clientX, e.clientY)) {
    drag = 'pet';
    setState('idle', 1.5);
  } else {
    return;
  }
  mouse.vx = mouse.vy = 0;
  document.body.classList.add('dragging');
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  const vx = clamp(mouse.vx, -2200, 2200), vy = clamp(mouse.vy, -2200, 2200);
  if (drag === 'pet') {
    pet.vx = vx; pet.vy = vy;
  } else if (food) {
    food.held = false;
    if (hitPet(food.x, food.y) && pet.onGround) {
      // Soltada sobre la mascota: se la come directamente.
      food.x = pet.x + pet.dir * 34 * cfg.scale;
      food.y = pet.y - 16;
      food.landed = true;
      startEating();
    } else {
      food.vx = vx * 0.5; food.vy = vy * 0.5;
    }
  }
  drag = null;
  document.body.classList.remove('dragging');
  refreshHover();
});

// Si la ventana pierde el foco a mitad de un arrastre, se suelta lo que se llevaba.
window.addEventListener('blur', () => { if (drag) window.dispatchEvent(new MouseEvent('mouseup')); });

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (hitPet(e.clientX, e.clientY)) tf.showPetMenu();
});

tf.onPetAction((action) => {
  if (action === 'feed') {
    const side = pet.x > app.screen.width / 2 ? -1 : 1;
    spawnFood(clamp(pet.x + side * 240, 30, app.screen.width - 30), Math.max(40, pet.y - 320));
    if (pet.state === 'sleep') setState('idle', 0.3);
    else pet.timer = Math.min(pet.timer, 0.3);
  } else if (action === 'sleep') {
    setState('sleep', 60);
    pet.sentToBed = true;
  } else if (action === 'wake') {
    setState('idle', 1);
  } else if (action === 'pet') {
    // Acariciar desde el menú: varias caricias seguidas con un ronroneo largo.
    audio.purr(3.2);
    if (pet.state === 'walk') setState('idle', 3);
    for (let i = 0; i < 4; i++) setTimeout(stroke, i * 550);
  } else if (action === 'meow' || action.startsWith('meow:')) {
    speak('♪', action.slice(5) || undefined); // 'meow:archivo' prueba un maullido concreto
  }
});

// ---------- Arranque ----------
tf.onSettings(applySettings);
tf.onWindows(onWindows);
tf.onWindowGone(onWindowGone);
tf.onAvatarChanged(loadAvatar);
tf.onSoundsChanged(() => audio.reloadCustom());

applySettings(await tf.getSettings());
needs.load(await tf.getState());
await loadAvatar();
audio.reloadCustom().catch((err) => console.warn('sonidos:', err.message));
audio.loadBuiltin().catch((err) => console.warn('grabaciones incluidas:', err.message));
scheduleMeow();

setInterval(() => tf.saveState(needs.toJSON()), 30000);
window.addEventListener('beforeunload', () => tf.saveState(needs.toJSON()));

console.log(`overlay listo ${app.screen.width}x${app.screen.height} renderer=${app.renderer.name}`);
