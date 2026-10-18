const { spawn } = require('child_process');

console.log('Starting Turbo Download Manager Server...');

// server.js is an ES module; dynamic import keeps this CommonJS entry point
// compatible with the Node 18+ versions documented for the project.
import('./server.js').then(() => {
  setTimeout(() => {
    const url = 'http://127.0.0.1:4820';
    spawn('cmd.exe', ['/c', 'start', 'msedge', `--app=${url}`], { stdio: 'ignore' });
  }, 1200);
}).catch((err) => {
  console.error('[Turbo Download Manager] Failed to start:', err);
  process.exitCode = 1;
});
