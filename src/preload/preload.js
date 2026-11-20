// Puente seguro entre los renderers (sin acceso a Node) y el proceso principal.
// Lo comparten el overlay de la mascota y la ventana de ajustes.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel) => (...args) => ipcRenderer.send(channel, ...args);
const on = (channel) => (callback) => { ipcRenderer.on(channel, (_e, ...args) => callback(...args)); };

contextBridge.exposeInMainWorld('tf', {
  // Overlay
  setIgnoreMouse: send('overlay:set-ignore'),
  showPetMenu: send('pet:show-menu'),
  onPetAction: on('pet:action'),
  onWindows: on('windows:update'),
  onWindowGone: on('windows:gone'),
  getState: invoke('state:get'),
  saveState: send('state:save'),

  // Ajustes
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  onSettings: on('settings:changed'),
  listDisplays: invoke('displays:list'),
  openSettings: send('settings:open'),
  petAction: send('pet:action'),

  // Avatares
  getActiveAvatar: invoke('avatar:active'),
  onAvatarChanged: on('avatar:changed'),
  listAvatars: invoke('avatar:list'),
  importPhoto: invoke('avatar:import'),
  selectAvatar: invoke('avatar:select'),
  updateAvatar: invoke('avatar:update'),
  deleteAvatar: invoke('avatar:delete'),
  listPoses: invoke('avatar:poses'),
  getAvatar: invoke('avatar:get'),
  setPose: invoke('avatar:set-pose'),
  removePose: invoke('avatar:remove-pose'),
  onProgress: on('progress'),

  // Sonidos
  listSounds: invoke('sounds:list'),
  getBuiltinSounds: invoke('sounds:builtin'),
  listBuiltinMeows: invoke('sounds:builtin-names'),
  addSounds: invoke('sounds:add'),
  removeSound: invoke('sounds:remove'),
  readSound: invoke('sounds:read'),
  onSoundsChanged: on('sounds:changed'),
});
