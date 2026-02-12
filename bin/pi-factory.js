#!/usr/bin/env node
// =============================================================================
// Pi-Factory CLI
// =============================================================================

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith('-')) || 'start';
const flags = new Set(args.filter(a => a.startsWith('-')));

const port = process.env.PORT || '3000';
const host = process.env.HOST || '0.0.0.0';

function startServer() {
  const serverPath = join(__dirname, '..', 'dist', 'server.js');

  console.log(`Starting Pi-Factory server on http://localhost:${port}...`);

  const proc = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: { ...process.env, PORT: port, HOST: host },
  });

  // Auto-open browser
  if (flags.has('--open') || flags.has('-o')) {
    setTimeout(() => {
      const url = `http://localhost:${port}`;
      try {
        if (process.platform === 'darwin') execSync(`open ${url}`);
        else if (process.platform === 'linux') execSync(`xdg-open ${url}`);
        else if (process.platform === 'win32') execSync(`start ${url}`);
      } catch { /* ignore */ }
    }, 1500);
  }

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

Options:
  --open, -o      Open browser after starting
  --help, -h      Show this help message
  --version, -v   Show version

Environment Variables:
  PORT            Server port (default: 3000)
  HOST            Server host (default: 0.0.0.0)

Keyboard Shortcuts (in UI):
  Esc             Deselect task (return to planning mode)
  ⌘/Ctrl+N       Create new task
  ⌘/Ctrl+K       Focus chat input

Examples:
  pi-factory                    # Start server on default port
  pi-factory --open             # Start and open browser
  PORT=8080 pi-factory          # Start on port 8080
`);
}

if (flags.has('--help') || flags.has('-h')) {
  showHelp();
} else if (flags.has('--version') || flags.has('-v')) {
  const pkg = JSON.parse(
    (await import('fs')).readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
  );
  console.log(pkg.version);
} else {
  startServer();
}
