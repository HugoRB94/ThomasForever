// Lanza Electron limpiando ELECTRON_RUN_AS_NODE: algunos terminales (p. ej. los que
// heredan el entorno de VS Code) la definen y hacen que Electron arranque como Node puro.
const { spawn } = require('node:child_process');
const path = require('node:path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--debug')) env.TF_DEBUG = '1'; // logs y bordes de ventana visibles

const child = spawn(require('electron'), [path.join(__dirname, '..'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code) => process.exit(code ?? 0));
