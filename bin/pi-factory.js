#!/usr/bin/env node
// =============================================================================
// Task Factory CLI
// =============================================================================

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('-')));
const command = args.find((arg) => !arg.startsWith('-')) || 'start';

const rawPort = process.env.PORT || '3000';
const port = /^\d+$/.test(rawPort) ? rawPort : '3000';
const host = process.env.HOST?.trim() || '127.0.0.1';
const url = `http://localhost:${port}`;

function shouldOpenBrowser() {
  if (flags.has('--no-open')) return false;
  if (flags.has('--open') || flags.has('-o')) return true;
  return true;
}

function getOpenCommand(urlToOpen) {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [urlToOpen] };
  }

  if (process.platform === 'linux') {
    return { command: 'xdg-open', args: [urlToOpen] };
  }

  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', urlToOpen] };
  }

  return null;
}

function openBrowser(urlToOpen) {
  let warned = false;
  const warnManualOpen = () => {
    if (warned) return;
    warned = true;
    console.warn(`Could not auto-open browser. Open manually: ${urlToOpen}`);
  };

  const openCommand = getOpenCommand(urlToOpen);
  if (!openCommand) {
    warnManualOpen();
    return;
  }

  try {
    const openProc = spawn(openCommand.command, openCommand.args, {
      stdio: 'ignore',
      detached: true,
    });

    openProc.on('error', warnManualOpen);
    openProc.on('exit', (code) => {
      if (typeof code === 'number' && code !== 0) {
        warnManualOpen();
      }
    });
    openProc.unref();
  } catch {
    warnManualOpen();
  }
}

function startServer() {
  const serverPath = join(__dirname, '..', 'dist', 'server.js');

  if (!existsSync(serverPath)) {
    console.error(`Task Factory server bundle not found at ${serverPath}. Run \"npm run build\" before starting.`);
    process.exit(1);
  }

  console.log(`Starting Task Factory server on ${url}...`);

  const proc = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    env: { ...process.env, PORT: port, HOST: host },
  });

  proc.on('error', (error) => {
    console.error(`Failed to start Task Factory server: ${error.message}`);
    process.exit(1);
  });

  if (shouldOpenBrowser()) {
    setTimeout(() => {
      openBrowser(url);
    }, 1500);
  }

  proc.on('exit', (code) => {
    process.exit(code || 0);
  });

  process.on('SIGINT', () => {
    proc.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM');
  });
}

function showHelp() {
  console.log(`
Task Factory - TPS-inspired Agent Work Queue

Usage:
  pifactory [command] [options]

Commands:
  start           Start the server (default)

Options:
  --no-open       Do not open browser after starting
  --open, -o      Force browser open (default behavior)
  --help, -h      Show this help message
  --version, -v   Show version

Environment Variables:
  PORT            Server port (default: 3000)
  HOST            Server host (default: 127.0.0.1)

Keyboard Shortcuts (in UI):
  Esc             Deselect task (return to planning mode)
  ⌘/Ctrl+N       Create new task
  ⌘/Ctrl+K       Focus chat input

Examples:
  pifactory                           # Start server and auto-open browser
  pifactory --no-open                 # Start server without opening browser
  PORT=8080 HOST=127.0.0.1 pifactory  # Start on port 8080 (loopback only)
  HOST=0.0.0.0 pifactory              # Expose on your network (explicit opt-in)
  pi-factory                          # Compatibility alias
`);
}

if (flags.has('--help') || flags.has('-h')) {
  showHelp();
} else if (flags.has('--version') || flags.has('-v')) {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  console.log(pkg.version);
} else if (command === 'start') {
  startServer();
} else {
  console.error(`Unknown command: ${command}`);
  showHelp();
  process.exit(1);
}
