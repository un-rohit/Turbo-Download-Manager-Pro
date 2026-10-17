const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Start the server process or import server directly
const appDir = __dirname;
console.log('Starting Turbo Download Manager Server...');

// Launch desktop window
setTimeout(() => {
  const url = 'http://127.0.0.1:4820';
  spawn('cmd.exe', ['/c', 'start', 'msedge', `--app=${url}`], { stdio: 'ignore' });
}, 1200);

require('./server.js');
