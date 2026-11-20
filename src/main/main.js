// Proceso principal: ventana overlay transparente, ventana de ajustes, bandeja,
// seguimiento de ventanas del SO y toda la persistencia (ajustes, avatares, sonidos).
const { app, BrowserWindow, ipcMain, screen, Menu, globalShortcut, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { JsonFile, DEFAULTS } = require('./settings-store');
const { WindowsTracker } = require('./windows-tracker');
const { AvatarStore, POSES } = require('./avatars');
const { SoundStore } = require('./sounds');
const { createTray, drawIcon } = require('./tray');

const DEBUG = !!process.env.TF_DEBUG;
// Carpeta de datos alternativa para pruebas (no toca los datos reales del usuario).
if (process.env.TF_USER_DATA) app.setPath('userData', path.resolve(process.env.TF_USER_DATA));
const argValue = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

let overlay = null;
let settingsWin = null;
let tray = null;
let settings, petState, avatars, sounds, tracker;
let busy = false; // una sola importación/generación a la vez

// La app solo muestra sus propias páginas locales: nada de navegar, abrir ventanas o webviews.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

// Un error inesperado no debe tumbar la mascota ni mostrar un cuadro de diálogo.
process.on('uncaughtException', (err) => console.error('[error no controlado]', err));
process.on('unhandledRejection', (err) => console.error('[promesa rechazada]', err));

const alive = (w) => w && !w.isDestroyed();
const toOverlay = (channel, ...args) => { if (alive(overlay)) overlay.webContents.send(channel, ...args); };
const toSettings = (channel, ...args) => { if (alive(settingsWin)) settingsWin.webContents.send(channel, ...args); };
const broadcast = (channel, ...args) => { toOverlay(channel, ...args); toSettings(channel, ...args); };
const progress = (message, fraction = null) => {
  if (DEBUG) console.log('[progreso]', message);
  toSettings('progress', { message, fraction });
};

function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return Number(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0));
}

function targetDisplay() {
  const id = settings.get('displayId');
  return screen.getAllDisplays().find((d) => d.id === id) || screen.getPrimaryDisplay();
}

function publicSettings() {
  return {
    ...settings.get(),
    debug: DEBUG,
    packaged: app.isPackaged,
    trackerAvailable: tracker.available,
  };
}

// Solo se aceptan claves conocidas, con el tipo correcto y dentro de rango.
function sanitizePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  const num = (key, lo, hi) => {
    if (patch[key] == null || patch[key] === '') return; // ausente: se queda el valor por defecto
    const n = Number(patch[key]);
    if (Number.isFinite(n)) out[key] = Math.min(hi, Math.max(lo, n));
  };
  if (typeof patch.petName === 'string') out.petName = patch.petName.slice(0, 40) || DEFAULTS.petName;
  num('petScale', 0.4, 3);
  num('activity', 0, 1);
  num('volume', 0, 1);
  num('meowIntervalMin', 0, 120);
  if ('windowInteraction' in patch) out.windowInteraction = !!patch.windowInteraction;
  if ('launchAtLogin' in patch) out.launchAtLogin = !!patch.launchAtLogin;
  if ('displayId' in patch) out.displayId = Number.isFinite(Number(patch.displayId)) && patch.displayId != null ? Number(patch.displayId) : null;
  if (Array.isArray(patch.mutedSounds)) {
    out.mutedSounds = patch.mutedSounds.filter((x) => typeof x === 'string').slice(0, 200).map((x) => path.basename(x));
  }
  if ('cutoutQuality' in patch) out.cutoutQuality = patch.cutoutQuality === 'fast' ? 'fast' : 'high';
  return out;
}

// Al arrancar, el fichero de ajustes se pasa por la misma validación: si alguien lo ha
// editado a mano o está dañado, los valores raros vuelven a su valor por defecto.
function normalizeSettings() {
  const raw = settings.get();
  const clean = { ...DEFAULTS, ...sanitizePatch(raw) };
  if (typeof raw.activeAvatar === 'string' && /^[a-z0-9-]+$/i.test(raw.activeAvatar)) clean.activeAvatar = raw.activeAvatar;
  settings.data = clean;
}

// Las imágenes llegan del renderer como data URL: se comprueba tipo y tamaño.
function checkImage(dataURL) {
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image/') || dataURL.length > 60e6) {
    throw new Error('Imagen no válida o demasiado grande');
  }
  return dataURL;
}

function fitOverlay() {
  if (!alive(overlay)) return;
  // workArea excluye la barra de tareas: el borde inferior de la ventana es el "suelo".
  overlay.setBounds(targetDisplay().workArea);
}

function applySettings() {
  fitOverlay();
  if (settings.get('windowInteraction') && alive(overlay) && overlay.isVisible()) {
    tracker.last = '';
    tracker.start();
  } else {
    tracker.stop();
    toOverlay('windows:update', []);
  }
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.get('launchAtLogin') });
  tray?.rebuild();
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...targetDisplay().workArea,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'ThomasForever',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required', // los maullidos no nacen de un clic
    },
  });

  // 'screen-saver' mantiene la mascota por encima de casi todo (incluida la barra de tareas).
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // Por defecto los clics atraviesan la ventana; forward:true sigue enviando mousemove
  // al renderer para que detecte cuándo el cursor está sobre la mascota.
  overlay.setIgnoreMouseEvents(true, { forward: true });

  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  overlay.once('ready-to-show', () => { overlay.showInactive(); applySettings(); });
  overlay.webContents.on('did-finish-load', () => { tracker.last = ''; });

  overlay.webContents.on('console-message', (e) => {
    if (DEBUG || e.level === 'error') {
      console.log(`[overlay:${e.level}] ${e.message} (${path.basename(e.sourceId || '')}:${e.lineNumber})`);
    }
  });
  // Si el proceso de la mascota se cae, se recarga (con un tope para no entrar en bucle).
  let reloads = [];
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[overlay caído]', details.reason);
    if (details.reason === 'clean-exit' || !alive(overlay)) return;
    const now = Date.now();
    reloads = reloads.filter((t) => now - t < 60000);
    if (reloads.length >= 3) return;
    reloads.push(now);
    setTimeout(() => { if (alive(overlay)) overlay.reload(); }, 500);
  });
  overlay.on('always-on-top-changed', (_e, onTop) => {
    if (!onTop && alive(overlay)) overlay.setAlwaysOnTop(true, 'screen-saver');
  });
}

function openSettings() {
  if (alive(settingsWin)) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 860,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    title: 'Ajustes · ThomasForever',
    icon: drawIcon(64),
    autoHideMenuBar: true,
    backgroundColor: '#17151a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, '..', 'settings', 'index.html'));
  settingsWin.webContents.on('console-message', (e) => {
    if (DEBUG || e.level === 'error') console.log(`[ajustes:${e.level}] ${e.message}`);
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function toggleOverlay() {
  if (!alive(overlay)) return;
  if (overlay.isVisible()) overlay.hide(); else overlay.showInactive();
  applySettings();
}

async function exclusive(task) {
  if (busy) throw new Error('Ya hay una operación en curso; espera a que termine');
  busy = true;
  try { return await task(); } finally { busy = false; }
}

function selectAvatar(id) {
  settings.set({ activeAvatar: id });
  broadcast('avatar:changed');
}

function registerIpc() {
  // Solo se atienden mensajes de las dos ventanas propias de la app.
  const trusted = (e) => [overlay, settingsWin].some((w) => alive(w) && w.webContents === e.sender);
  const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('Origen no autorizado');
    return fn(e, ...args);
  });
  const listen = (channel, fn) => ipcMain.on(channel, (e, ...args) => { if (trusted(e)) fn(e, ...args); });

  // ---- Overlay ----
  listen('overlay:set-ignore', (_e, ignore) => {
    if (!alive(overlay)) return;
    if (ignore) overlay.setIgnoreMouseEvents(true, { forward: true });
    else overlay.setIgnoreMouseEvents(false);
  });

  listen('pet:show-menu', () => {
    if (!alive(overlay)) return;
    const act = (action) => () => toOverlay('pet:action', action);
    Menu.buildFromTemplate([
      { label: 'Acariciar', click: act('pet') },
      { label: 'Dar de comer', click: act('feed') },
      { label: 'A dormir', click: act('sleep') },
      { label: 'Despertar', click: act('wake') },
      { type: 'separator' },
      { label: 'Ajustes…', click: openSettings },
      { label: 'Ocultar mascota', click: toggleOverlay },
      { label: 'Salir de ThomasForever', click: () => app.quit() },
    ]).popup({ window: overlay });
  });

  listen('pet:action', (_e, action) => toOverlay('pet:action', String(action)));
  handle('state:get', () => petState.get());
  listen('state:save', (_e, state) => {
    if (!state || typeof state !== 'object') return;
    const clean = {};
    for (const key of ['food', 'energy', 'love', 'savedAt']) {
      if (Number.isFinite(state[key])) clean[key] = state[key];
    }
    petState.set(clean);
  });

  // ---- Ajustes ----
  listen('settings:open', openSettings);
  handle('settings:get', () => publicSettings());
  handle('settings:set', (_e, patch) => {
    settings.set(sanitizePatch(patch));
    applySettings();
    broadcast('settings:changed', publicSettings());
    return publicSettings();
  });
  handle('displays:list', () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `Pantalla ${i + 1} · ${d.size.width}×${d.size.height}${d.id === primary ? ' (principal)' : ''}`,
    }));
  });
  // ---- Avatares ----
  handle('avatar:list', () => ({ active: settings.get('activeAvatar'), items: avatars.list() }));
  handle('avatar:active', () => {
    const id = settings.get('activeAvatar');
    return id === 'default' ? null : avatars.get(id);
  });
  handle('avatar:import', (_e, { dataURL, name }) => exclusive(async () => {
    const manifest = await avatars.importPhoto({ dataURL: checkImage(dataURL) }, name, settings.get('cutoutQuality'), progress);
    selectAvatar(manifest.id);
    progress('Avatar creado', 1);
    return manifest.id;
  }));
  handle('avatar:poses', () => Object.entries(POSES).map(([name, p]) => ({ name, label: p.label })));
  handle('avatar:get', (_e, id) => avatars.get(id));
  handle('avatar:set-pose', (_e, { id, pose, dataURL }) => exclusive(async () => {
    await avatars.setPose(id, pose, { dataURL: checkImage(dataURL) }, settings.get('cutoutQuality'), progress);
    broadcast('avatar:changed');
    progress('Pose añadida', 1);
  }));
  handle('avatar:remove-pose', (_e, { id, pose }) => {
    avatars.removePose(id, pose);
    broadcast('avatar:changed');
  });
  handle('avatar:select', (_e, id) => {
    if (id !== 'default' && !avatars.get(id)) throw new Error('Ese avatar ya no existe');
    selectAvatar(id);
  });
  handle('avatar:update', (_e, id, patch) => {
    avatars.update(id, patch || {});
    broadcast('avatar:changed');
  });
  handle('avatar:delete', (_e, id) => {
    avatars.remove(id);
    if (settings.get('activeAvatar') === id) settings.set({ activeAvatar: 'default' });
    broadcast('avatar:changed');
  });
  // ---- Sonidos ----
  handle('sounds:list', () => sounds.list());
  // Grabaciones reales incluidas con la app (assets/sounds): meow-*.* y purr-*.*
  const builtinDir = path.join(__dirname, '..', '..', 'assets', 'sounds');
  const builtinFiles = (prefix) => (fs.existsSync(builtinDir) ? fs.readdirSync(builtinDir) : [])
    .filter((f) => f.startsWith(prefix) && /\.(ogg|oga|wav|flac|mp3|opus)$/i.test(f))
    .sort();
  const readBuiltin = (prefix) => builtinFiles(prefix).map((name) => ({ name, bytes: fs.readFileSync(path.join(builtinDir, name)) }));
  handle('sounds:builtin', () => ({ meows: readBuiltin('meow'), purrs: readBuiltin('purr') }));
  handle('sounds:builtin-names', () => builtinFiles('meow'));
  handle('sounds:read', (_e, name) => sounds.read(name));
  handle('sounds:add', async () => {
    const res = await sounds.addWithDialog(settingsWin);
    if (res.added) broadcast('sounds:changed');
    return res;
  });
  handle('sounds:remove', (_e, name) => {
    sounds.remove(name);
    broadcast('sounds:changed');
  });
}

// Línea de comandos:
//   --import-photo=C:\ruta\foto.jpg [--name=Nombre]   crea un avatar y lo selecciona
//   --add-pose=pose:C:\ruta\foto.jpg                  añade una pose al avatar activo (repetible)
async function runCliCommands(argv) {
  const value = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null;
  const say = (m) => console.log('[cli]', m);
  const quality = settings.get('cutoutQuality');
  try {
    const photo = value('import-photo');
    if (photo) {
      const manifest = await exclusive(() => avatars.importPhoto({ path: photo }, value('name') || path.parse(photo).name, quality, say));
      selectAvatar(manifest.id);
      say(`avatar creado: ${manifest.id} ${JSON.stringify(manifest.frames.idle)}`);
    }
    for (const arg of argv.filter((a) => a.startsWith('--add-pose='))) {
      const spec = arg.slice('--add-pose='.length);
      const cut = spec.indexOf(':');
      const pose = spec.slice(0, cut), file = spec.slice(cut + 1);
      const id = settings.get('activeAvatar');
      if (id === 'default') throw new Error('No hay un avatar de foto activo al que añadir poses');
      const manifest = await exclusive(() => avatars.setPose(id, pose, { path: file }, quality, say));
      broadcast('avatar:changed');
      say(`pose añadida: ${pose} ${JSON.stringify(manifest.frames[pose])}`);
    }
    if (photo || argv.some((a) => a.startsWith('--add-pose='))) say('listo');
  } catch (err) {
    console.error('[cli] error:', err.message);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Una segunda ejecución abre los ajustes, o envía una acción a la mascota:
  //   ThomasForever --action=meow|pet|feed|sleep|wake
  app.on('second-instance', (_e, argv) => {
    const action = (argv.find((a) => a.startsWith('--action=')) || '').slice(9);
    if (['meow', 'pet', 'feed', 'sleep', 'wake'].includes(action)) toOverlay('pet:action', action);
    else openSettings();
  });

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    settings = new JsonFile(path.join(userData, 'settings.json'), DEFAULTS);
    normalizeSettings();
    // Ninguna página de la app necesita cámara, micrófono, ubicación, notificaciones…
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    petState = new JsonFile(path.join(userData, 'pet-state.json'));
    avatars = new AvatarStore(path.join(userData, 'avatars'), path.join(userData, 'models'));
    sounds = new SoundStore(path.join(userData, 'sounds'));
    tracker = new WindowsTracker(
      () => (alive(overlay)
        ? { exclude: [hwndOf(overlay)], bounds: overlay.getBounds(), toDip: (r) => screen.screenToDipRect(null, r) }
        : null),
      (platforms) => toOverlay('windows:update', platforms),
      (gone) => toOverlay('windows:gone', gone),
    );

    registerIpc();
    createOverlay();

    tray = createTray({
      getName: () => settings.get('petName'),
      onSettings: openSettings,
      onAction: (action) => toOverlay('pet:action', action),
      onToggle: toggleOverlay,
      isVisible: () => alive(overlay) && overlay.isVisible(),
      onQuit: () => app.quit(),
    });

    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', fitOverlay);
    screen.on('display-removed', fitOverlay);
    globalShortcut.register('Control+Alt+Shift+Q', () => app.quit()); // salida de emergencia

    runCliCommands(process.argv);
    if (process.argv.includes('--settings')) openSettings();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    tracker?.stop();
  });
  // La app vive en la bandeja: cerrar la ventana de ajustes no la termina.
  app.on('window-all-closed', () => app.quit());
}
