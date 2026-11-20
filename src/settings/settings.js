// Ventana de ajustes. Todo cambio se guarda al momento y se aplica en vivo al overlay.
/* global tf */ // API expuesta por el preload
const $ = (id) => document.getElementById(id);
const errorText = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

let settings = null;
let avatars = { active: 'default', items: [] };
let progressTarget = null; // { bar, status } de la operación en curso

function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = `status${el.classList.contains('block') ? ' block' : ''}${kind ? ' ' + kind : ''}`;
}

// ---------- Pestañas ----------
for (const btn of document.querySelectorAll('nav button')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${btn.dataset.tab}`));
  });
}

// ---------- Controles enlazados a ajustes ----------
const pct = (v) => `${Math.round(v * 100)} %`;
const meowLabel = (v) => (Number(v) === 0 ? 'nunca' : `cada ~${v} min`);
const bindings = [
  { id: 'pet-scale', key: 'petScale', out: 'scale-out', fmt: pct, num: true },
  { id: 'activity', key: 'activity', out: 'activity-out', fmt: pct, num: true },
  { id: 'volume', key: 'volume', out: 'volume-out', fmt: pct, num: true },
  { id: 'meow-interval', key: 'meowIntervalMin', out: 'meow-out', fmt: meowLabel, num: true },
  { id: 'pet-name', key: 'petName', event: 'change' },
  { id: 'cutout-quality', key: 'cutoutQuality', event: 'change' },
  { id: 'window-interaction', key: 'windowInteraction', check: true },
  { id: 'launch-at-login', key: 'launchAtLogin', check: true },
];

function renderSettings() {
  for (const b of bindings) {
    const el = $(b.id);
    if (document.activeElement === el && !b.check) continue; // no pisar lo que se está editando
    if (b.check) el.checked = !!settings[b.key];
    else el.value = settings[b.key];
    if (b.out) $(b.out).textContent = b.fmt(settings[b.key]);
  }
  $('tracker-note').hidden = settings.trackerAvailable;
  $('window-interaction').disabled = !settings.trackerAvailable;
  $('login-note').hidden = settings.packaged;
}

for (const b of bindings) {
  const el = $(b.id);
  el.addEventListener(b.event || (b.check ? 'change' : 'input'), async () => {
    const value = b.check ? el.checked : b.num ? Number(el.value) : el.value;
    if (b.out) $(b.out).textContent = b.fmt(value);
    settings = await tf.setSettings({ [b.key]: value });
  });
}

async function loadDisplays() {
  const list = await tf.listDisplays();
  const sel = $('display');
  sel.replaceChildren(...list.map((d) => new Option(d.label, d.id)));
  const current = list.find((d) => d.id === settings.displayId);
  sel.value = current ? current.id : (list.find((d) => d.label.includes('principal')) || list[0]).id;
}
$('display').addEventListener('change', async (e) => {
  settings = await tf.setSettings({ displayId: Number(e.target.value) });
});

// ---------- Avatares ----------
function avatarCard({ id, name, kind, thumb, removable }) {
  const card = document.createElement('div');
  card.className = `avatar${avatars.active === id ? ' selected' : ''}`;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  const thumbBox = document.createElement('span');
  thumbBox.className = 'thumb';
  if (thumb) {
    const img = document.createElement('img');
    img.src = thumb;
    img.alt = '';
    thumbBox.append(img);
  } else {
    thumbBox.textContent = '🐱';
  }
  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = name;
  const kindEl = document.createElement('span');
  kindEl.className = 'kind';
  kindEl.textContent = kind;
  card.append(thumbBox, nameEl, kindEl);

  const select = async () => { await tf.selectAvatar(id); await loadAvatars(); };
  card.addEventListener('click', select);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });

  if (removable) {
    const rm = document.createElement('button');
    rm.className = 'remove';
    rm.textContent = '×';
    rm.title = `Eliminar ${name}`;
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar el avatar "${name}"? No se puede deshacer.`)) return;
      await tf.deleteAvatar(id);
      await loadAvatars();
    });
    card.append(rm);
  }
  return card;
}

const activeAvatar = () => avatars.items.find((a) => a.id === avatars.active) || null;

async function loadAvatars() {
  avatars = await tf.listAvatars();
  $('avatars').replaceChildren(
    avatarCard({ id: 'default', name: 'Gato de prueba', kind: 'incluido' }),
    ...avatars.items.map((a) => avatarCard({
      id: a.id,
      name: a.name,
      kind: a.poses.length > 1 ? `fotos · ${a.poses.length} poses` : 'desde foto',
      thumb: a.thumb,
      removable: true,
    })),
  );
  const a = activeAvatar();
  $('avatar-options').hidden = !a;
  if (a) {
    if (document.activeElement !== $('avatar-name')) $('avatar-name').value = a.name;
    $('avatar-facing').value = a.facing;
    await renderPoses(a.id);
  }
}

// ---------- Poses desde fotos propias ----------
let poseList = null;
let pendingPose = null; // { id, pose } a la espera de que se elija la foto

async function renderPoses(id) {
  poseList = poseList || await tf.listPoses();
  const data = await tf.getAvatar(id);
  if (!data) return;
  $('poses').replaceChildren(...poseList.map(({ name, label }) => {
    const filled = !!data.frames[name];
    const slot = document.createElement('div');
    slot.className = `pose${filled ? ' filled' : ''}`;
    slot.tabIndex = 0;
    slot.setAttribute('role', 'button');
    slot.title = filled ? `Cambiar la foto de "${label}"` : `Añadir foto para "${label}"`;
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    if (filled) {
      const img = document.createElement('img');
      img.src = data.frames[name];
      img.alt = '';
      thumb.append(img);
    } else {
      thumb.textContent = '+';
    }
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = label;
    slot.append(thumb, nameEl);
    const choose = () => { pendingPose = { id, pose: name }; $('pose-input').click(); };
    slot.addEventListener('click', choose);
    slot.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    if (filled && name !== 'idle') {
      const rm = document.createElement('button');
      rm.className = 'remove';
      rm.textContent = '×';
      rm.title = `Quitar la pose "${label}"`;
      rm.addEventListener('click', async (e) => {
        e.stopPropagation();
        await tf.removePose({ id, pose: name });
        await loadAvatars();
      });
      slot.append(rm);
    }
    return slot;
  }));
}

$('pose-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !pendingPose) return;
  const status = $('pose-status'), bar = $('pose-progress');
  bar.hidden = false;
  bar.removeAttribute('value');
  progressTarget = { bar, status };
  setStatus(status, 'Leyendo la foto…');
  try {
    await tf.setPose({ ...pendingPose, dataURL: await fileToDataUrl(file) });
    setStatus(status, 'Pose añadida', 'ok');
    await loadAvatars();
  } catch (err) {
    setStatus(status, errorText(err), 'error');
  } finally {
    progressTarget = null;
    pendingPose = null;
    bar.hidden = true;
  }
});

$('avatar-name').addEventListener('change', async (e) => {
  const a = activeAvatar();
  if (a && e.target.value.trim()) { await tf.updateAvatar(a.id, { name: e.target.value }); await loadAvatars(); }
});
$('avatar-facing').addEventListener('change', async (e) => {
  const a = activeAvatar();
  if (a) { await tf.updateAvatar(a.id, { facing: e.target.value }); await loadAvatars(); }
});

// La imagen se decodifica aquí (Chromium admite JPG, PNG, WebP, AVIF…) y se envía
// al proceso principal ya reducida y en PNG.
async function fileToDataUrl(file, maxSide = 1024) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

$('pick-photo').addEventListener('click', () => $('photo-input').click());
$('photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('import-status'), bar = $('import-progress');
  $('pick-photo').disabled = true;
  bar.hidden = false;
  bar.removeAttribute('value');
  progressTarget = { bar, status };
  setStatus(status, 'Leyendo la foto…');
  try {
    const dataURL = await fileToDataUrl(file);
    const name = $('new-name').value.trim() || file.name.replace(/\.[^.]+$/, '');
    await tf.importPhoto({ dataURL, name });
    setStatus(status, 'Listo: ya está en tu escritorio', 'ok');
    $('new-name').value = '';
    await loadAvatars();
  } catch (err) {
    setStatus(status, errorText(err), 'error');
  } finally {
    progressTarget = null;
    bar.hidden = true;
    $('pick-photo').disabled = false;
  }
});

tf.onProgress(({ message, fraction }) => {
  if (!progressTarget) return;
  setStatus(progressTarget.status, message);
  if (fraction == null) progressTarget.bar.removeAttribute('value');
  else progressTarget.bar.value = fraction;
});

// ---------- Maullidos incluidos: escuchar y elegir ----------
async function loadBuiltinMeows() {
  const names = await tf.listBuiltinMeows();
  const muted = new Set(settings.mutedSounds || []);
  const pretty = (n) => n.replace(/^meow-/, '').replace(/\.\w+$/, '').replace(/-/g, ' ');
  $('builtin-meows').replaceChildren(...names.map((name) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !muted.has(name);
    box.addEventListener('change', async () => {
      // El conjunto se actualiza al instante: varios clics seguidos no se pisan entre sí.
      if (box.checked) muted.delete(name); else muted.add(name);
      settings = await tf.setSettings({ mutedSounds: [...muted] });
    });
    const text = document.createElement('span');
    text.textContent = `Maullido · ${pretty(name)}`;
    label.append(box, text);
    const play = document.createElement('button');
    play.textContent = '▶ Escuchar';
    play.addEventListener('click', () => tf.petAction('meow:' + name));
    li.append(label, play);
    return li;
  }));
}

// ---------- Sonidos ----------
async function loadSounds() {
  const names = await tf.listSounds();
  const list = $('sounds');
  if (!names.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Aún no hay audios propios: se usan los maullidos incluidos.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...names.map((name) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = name;
    const rm = document.createElement('button');
    rm.textContent = 'Quitar';
    rm.addEventListener('click', async () => { await tf.removeSound(name); await loadSounds(); });
    li.append(span, rm);
    return li;
  }));
}

$('add-sounds').addEventListener('click', async () => {
  const status = $('sound-status');
  try {
    const { added, skipped } = await tf.addSounds();
    const parts = [];
    if (added) parts.push(`${added} añadido${added > 1 ? 's' : ''}`);
    if (skipped.length) parts.push(`omitidos (formato no admitido o más de 20 MB): ${skipped.join(', ')}`);
    setStatus(status, parts.join(' · '), skipped.length ? 'error' : 'ok');
    await loadSounds();
  } catch (err) {
    setStatus(status, errorText(err), 'error');
  }
});
$('test-meow').addEventListener('click', () => tf.petAction('meow'));
$('test-purr').addEventListener('click', () => tf.petAction('pet'));

// ---------- Arranque ----------
tf.onSettings((s) => { settings = s; renderSettings(); });
tf.onAvatarChanged(loadAvatars);
tf.onSoundsChanged(loadSounds);

(async () => {
  settings = await tf.getSettings();
  renderSettings();
  await Promise.all([loadDisplays(), loadAvatars(), loadSounds(), loadBuiltinMeows()]);
})();
