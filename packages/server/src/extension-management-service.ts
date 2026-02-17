// =============================================================================
// Extension Management Service
// =============================================================================
// Handles creation, validation, and security scanning of TypeScript extensions

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import {
  getTaskFactoryGlobalExtensionsDir,
  getWorkspaceTaskFactoryExtensionsDir,
} from './taskfactory-home.js';

// Valid extension name pattern: lowercase letters, numbers, hyphens (1-64 chars, must start with letter/number)
const EXTENSION_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Security patterns to scan for
const DANGEROUS_PATTERNS = [
  {
    pattern: /\beval\s*\(/,
    message: 'Uses eval() which can execute arbitrary code',
  },
  {
    pattern: /\bFunction\s*\(\s*['"`]/,
    message: 'Uses Function constructor which can execute arbitrary code',
  },
  {
    pattern: /child_process/,
    message: 'Imports child_process which can execute shell commands',
  },
  {
    pattern: /\bexec\s*\(/,
    message: 'Uses exec() which can execute shell commands',
  },
  {
    pattern: /\bexecSync\s*\(/,
    message: 'Uses execSync() which can execute shell commands',
  },
  {
    pattern: /\bspawn\s*\(/,
    message: 'Uses spawn() which can execute shell commands',
  },
  {
    pattern: /\bimport\s*\(\s*['"`].*\$\{.*\}/,
    message: 'Dynamic import with template literal may allow code injection',
  },
  {
    pattern: /\brequire\s*\(\s*['"`].*\$\{.*\}/,
    message: 'Dynamic require with template literal may allow code injection',
  },
  {
    pattern: /process\.env\s*=/,
    message: 'Modifies process.env which could affect system behavior',
  },
  {
    pattern: /fs\.\w+\s*\(.*\$\{.*\}/,
    message: 'File system operations with template literals may be unsafe',
  },
  {
    pattern: /writeFile|unlink|rmdir|rm\s*\(/,
    message: 'File deletion/modification operations - ensure paths are validated',
  },
  {
    pattern: /fetch\s*\(\s*['"`].*\$\{.*\}/,
    message: 'Fetch with template literal may allow SSRF attacks',
  },
  {
    pattern: /http\.request|https\.request/,
    message: 'HTTP requests - ensure URLs are validated',
  },
  {
    pattern: /constructor\s*\(\s*['"`].*prototype/,
    message: 'Prototype manipulation may allow code injection',
  },
  {
    pattern: /__proto__|prototype\.constructor/,
    message: 'Prototype pollution attempt detected',
  },
];

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface SecurityScanResult {
  safe: boolean;
  warnings: string[];
}

interface CreateExtensionResult {
  success: boolean;
  path?: string;
  error?: string;
}

type ExtensionWriteDestination = 'global' | 'repo-local';

function resolveExtensionWriteDir(
  destination: ExtensionWriteDestination | undefined,
  workspacePath: string | undefined,
): { ok: true; path: string } | { ok: false; error: string } {
  const resolvedDestination: ExtensionWriteDestination = destination === 'repo-local' ? 'repo-local' : 'global';

  if (resolvedDestination === 'global') {
    const base = getTaskFactoryGlobalExtensionsDir();
    mkdirSync(base, { recursive: true });
    return { ok: true, path: base };
  }

  if (!workspacePath || workspacePath.trim().length === 0) {
    return { ok: false, error: 'workspacePath is required for repo-local extension destination' };
  }

  const base = getWorkspaceTaskFactoryExtensionsDir(workspacePath);
  mkdirSync(base, { recursive: true });
  return { ok: true, path: base };
}

/**
 * Validate extension name format
 */
export function validateExtensionName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim().toLowerCase();

  if (!trimmed) {
    return { valid: false, error: 'Extension name is required' };
  }

  if (!EXTENSION_NAME_PATTERN.test(trimmed)) {
    return {
      valid: false,
      error: 'Extension name must be lowercase letters, numbers, or hyphens (1-64 chars, must start with letter/number)',
    };
  }

  return { valid: true };
}

/**
 * Validate TypeScript syntax using the TypeScript compiler
 */
export async function validateExtensionTypeScript(code: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for basic module structure
  if (!code.includes('export default')) {
    warnings.push('Extension should export a default function');
  }

  if (!code.includes('ExtensionAPI')) {
    warnings.push('Extension should import or use ExtensionAPI type');
  }

  // Use TypeScript compiler to check for syntax errors
  const sourceFile = ts.createSourceFile(
    'extension.ts',
    code,
    ts.ScriptTarget.ES2022,
    true
  );

  // Get diagnostics
  const compilerHost: ts.CompilerHost = {
    getSourceFile: (fileName) => (fileName === 'extension.ts' ? sourceFile : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: () => true,
    readFile: () => '',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };

  const program = ts.createProgram(['extension.ts'], {
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: false,
    skipLibCheck: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
  }, compilerHost);

  const diagnostics = ts.getPreEmitDiagnostics(program);

  for (const diagnostic of diagnostics) {
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = ts.getLineAndCharacterOfPosition(
        diagnostic.file,
        diagnostic.start
      );
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      errors.push(`Line ${line + 1}, Col ${character + 1}: ${message}`);
    } else {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      errors.push(message);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Scan extension code for potentially dangerous patterns
 */
export async function scanExtensionSecurity(code: string): Promise<SecurityScanResult> {
  const warnings: string[] = [];

  for (const { pattern, message } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      warnings.push(message);
    }
  }

  return {
    safe: warnings.length === 0,
    warnings,
  };
}

/**
 * Create a new extension file
 */
export async function createFactoryExtension(payload: {
  name: string;
  audience: 'foreman' | 'task' | 'all';
  typescript: string;
  destination?: ExtensionWriteDestination;
  workspacePath?: string;
}): Promise<CreateExtensionResult> {
  const { name, typescript, destination, workspacePath } = payload;

  // Validate name
  const nameValidation = validateExtensionName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const normalizedName = name.trim().toLowerCase();

  // Resolve destination directory
  const resolvedWriteDir = resolveExtensionWriteDir(destination, workspacePath);
  if (!resolvedWriteDir.ok) {
    return { success: false, error: resolvedWriteDir.error };
  }

  const extensionsDir = resolvedWriteDir.path;

  // Check for duplicate
  const extensionPath = join(extensionsDir, `${normalizedName}.ts`);
  if (existsSync(extensionPath)) {
    return { success: false, error: `Extension "${normalizedName}" already exists at ${extensionPath}` };
  }

  try {
    // Write the file
    writeFileSync(extensionPath, typescript, 'utf-8');

    // Reload extensions (this is done by the caller via reloadRepoExtensions)

    return {
      success: true,
      path: extensionPath,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to write extension file: ${err.message || String(err)}`,
    };
  }
}
