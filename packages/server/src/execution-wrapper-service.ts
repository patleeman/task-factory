// =============================================================================
// Execution Wrapper Service
// =============================================================================
// Discovers and applies execution wrappers — pairs of pre/post skills that
// wrap the main agent execution.
//
// Wrappers live in the repo-local wrappers/ directory as YAML files:
//   wrappers/git-workflow.yaml
//
// Format:
//   name: Git Workflow
//   description: Stash changes, branch, execute, then checkpoint + PR
//   preExecutionSkills:
//     - git-stash-branch
//   postExecutionSkills:
//     - checkpoint
//     - code-review
//     - create-pr
//     - git-restore

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import type { ExecutionWrapper, Task } from '@pi-factory/shared';

// =============================================================================
// Wrapper Discovery
// =============================================================================

let _cachedWrappers: ExecutionWrapper[] | null = null;

/**
 * Find the wrappers/ directory by walking up from this file to the repo root.
 */
function findWrappersDir(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);

  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'wrappers');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Parse a wrapper YAML file into an ExecutionWrapper.
 */
function parseWrapperFile(filePath: string): ExecutionWrapper | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = YAML.parse(content);

    if (!parsed || typeof parsed !== 'object') return null;

    const name = parsed.name;
    const description = parsed.description;
    if (!name || !description) {
      console.warn(`[Wrappers] ${filePath} missing required name or description`);
      return null;
    }

    const id = basename(filePath).replace(/\.(yaml|yml)$/, '');

    return {
      id,
      name,
      description,
      preExecutionSkills: Array.isArray(parsed.preExecutionSkills)
        ? parsed.preExecutionSkills.filter((s: unknown) => typeof s === 'string')
        : [],
      postExecutionSkills: Array.isArray(parsed.postExecutionSkills)
        ? parsed.postExecutionSkills.filter((s: unknown) => typeof s === 'string')
        : [],
    };
  } catch (err) {
    console.error(`[Wrappers] Failed to parse ${filePath}:`, err);
    return null;
  }
}

/**
 * Discover all execution wrappers from the repo-local wrappers/ directory.
 */
export function discoverWrappers(): ExecutionWrapper[] {
  if (_cachedWrappers !== null) return _cachedWrappers;

  const wrappersDir = findWrappersDir();
  if (!wrappersDir) {
    _cachedWrappers = [];
    return _cachedWrappers;
  }

  const wrappers: ExecutionWrapper[] = [];
  const entries = readdirSync(wrappersDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    if (!entry.name.endsWith('.yaml') && !entry.name.endsWith('.yml')) continue;

    const wrapper = parseWrapperFile(join(wrappersDir, entry.name));
    if (wrapper) {
      wrappers.push(wrapper);
    }
  }

  if (wrappers.length > 0) {
    console.log(`[Wrappers] Discovered ${wrappers.length} execution wrapper(s):`,
      wrappers.map(w => w.id).join(', '));
  }

  _cachedWrappers = wrappers;
  return wrappers;
}

/**
 * Get a single wrapper by ID.
 */
export function getWrapper(id: string): ExecutionWrapper | null {
  const wrappers = discoverWrappers();
  return wrappers.find(w => w.id === id) || null;
}

/** Force re-discovery (e.g. after adding a new wrapper). */
export function reloadWrappers(): ExecutionWrapper[] {
  _cachedWrappers = null;
  return discoverWrappers();
}

/**
 * Apply a wrapper to a task — sets both pre and post execution skill arrays.
 * Returns the updated task (caller is responsible for persisting).
 */
export function applyWrapper(task: Task, wrapperId: string): Task {
  const wrapper = getWrapper(wrapperId);
  if (!wrapper) {
    throw new Error(`Execution wrapper "${wrapperId}" not found`);
  }

  task.frontmatter.preExecutionSkills = [...wrapper.preExecutionSkills];
  task.frontmatter.postExecutionSkills = [...wrapper.postExecutionSkills];

  return task;
}
