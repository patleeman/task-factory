#!/usr/bin/env node
// =============================================================================
// Pi-Factory CLI
// =============================================================================

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const command = args[0];

function startServer() {
  const serverPath = join(__dirname, '..', 'dist', 'server.js');
  
  console.log('Starting Pi-Factory server...');
  
  const proc = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: process.env,
  });

  proc.on('exit', (code) => {
    process.exit(code || 0);
  });

  process.on('SIGINT', () => {
    proc.kill('SIGINT');
  });
}

function showHelp() {
  console.log(`
Pi-Factory - TPS-inspired Agent Work Queue

Usage:
  pi-factory [command] [options]

Commands:
  start           Start the server (default)
  --help, -h      Show this help message
  --version, -v   Show version

Environment Variables:
  PORT            Server port (default: 9742)
  HOST            Server host (default: 0.0.0.0)

Examples:
  pi-factory                    # Start server on default port
  PORT=8080 pi-factory          # Start server on port 8080
`);
}

switch (command) {
  case '--help':
  case '-h':
    showHelp();
    break;
  case '--version':
  case '-v':
    console.log('0.1.0');
    break;
  case 'start':
  default:
    startServer();
    break;
}
