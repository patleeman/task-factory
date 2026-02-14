import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ArtifactViewer } from '../../client/src/components/ArtifactViewer';

const thisDir = dirname(fileURLToPath(import.meta.url));
const artifactViewerPath = resolve(thisDir, '../../client/src/components/ArtifactViewer.tsx');

describe('ArtifactViewer sandbox rendering', () => {
  it('renders artifact HTML via iframe srcDoc while preserving sandbox isolation', () => {
    const html = '<!doctype html><html><body><h1>Artifact</h1></body></html>';
    const element = ArtifactViewer({ html }) as {
      type: unknown;
      props?: {
        srcDoc?: unknown;
        sandbox?: unknown;
      };
    };

    expect(element.type).toBe('iframe');
    expect(element.props?.srcDoc).toBe(html);
    expect(element.props?.sandbox).toBe('allow-scripts');
    expect(String(element.props?.sandbox ?? '')).not.toContain('allow-same-origin');
  });

  it('does not use cross-origin-blocked iframe document write APIs', () => {
    const source = readFileSync(artifactViewerPath, 'utf8');

    expect(source).not.toMatch(/contentDocument|contentWindow|\.write\(|\.open\(|\.close\(/);
  });
});
