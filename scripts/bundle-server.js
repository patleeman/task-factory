#!/usr/bin/env node
// =============================================================================
// Bundle Server Script
// =============================================================================
// Bundles the server into a single file for distribution

import * as esbuild from 'esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = join(__dirname, '..');

async function bundle() {
  console.log('Bundling server...');

  await esbuild.build({
    entryPoints: [join(rootDir, 'packages/server/dist/index.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: join(rootDir, 'dist/server.js'),
    format: 'esm',
    external: [
      'better-sqlite3',
      '@mariozechner/pi-coding-agent',
    ],
    banner: {
      js: `import { createRequire } from 'module';
const require = createRequire(import.meta.url);`,
    },
  });

  console.log('Server bundled to dist/server.js');
}

bundle().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
