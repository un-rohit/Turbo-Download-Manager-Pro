import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(appDir, '..');
const server = spawn(process.execPath, ['server.js'], {
  cwd: projectRoot,
  stdio: 'inherit',
  windowsHide: true
});

server.on('error', (error) => {
  console.error('[Turbo Download Manager] Could not start the local server:', error.message);
});

const appUrl = 'http://127.0.0.1:4820';
setTimeout(() => {
  const edge = spawn('cmd.exe', ['/c', 'start', '', 'msedge', `--app=${appUrl}`], {
    stdio: 'ignore',
    windowsHide: true
  });
  edge.on('error', () => {
    spawn('cmd.exe', ['/c', 'start', '', appUrl], { stdio: 'ignore', windowsHide: true });
  });
}, 1000);

process.on('SIGINT', () => {
  server.kill('SIGINT');
  process.exit(0);
});
