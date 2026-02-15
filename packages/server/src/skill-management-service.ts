import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import type { SkillConfigField, SkillHook } from '@pi-factory/shared';
import { resolveTaskFactoryHomePath } from './taskfactory-home.js';

const RESERVED_METADATA_KEYS = new Set(['type', 'hooks', 'max-iterations', 'done-signal', 'workflow-id', 'pairs-with']);
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CONFIG_FIELD_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ALLOWED_CONFIG_TYPES = new Set<SkillConfigField['type']>(['string', 'number', 'boolean', 'select']);

const DEFAULT_DONE_SIGNAL = 'HOOK_DONE';
const DEFAULT_SKILL_HOOKS: SkillHook[] = ['pre', 'post'];
const SKILL_HOOK_SET = new Set<SkillHook>(DEFAULT_SKILL_HOOKS);
const DEFAULT_FACTORY_SKILLS_DIR = resolveTaskFactoryHomePath('skills');

interface NormalizedSkillDefinition {
  id: string;
  description: string;
  type: 'follow-up' | 'loop';
  hooks: SkillHook[];
  workflowId?: string;
  pairedSkillId?: string;
  maxIterations: number;
  doneSignal: string;
  promptTemplate: string;
  configSchema: SkillConfigField[];
  metadata: Record<string, string>;
}

interface SkillStorageOptions {
  skillsDir?: string;
}

export function getFactoryUserSkillsDir(): string {
  return DEFAULT_FACTORY_SKILLS_DIR;
}

function ensureDirExists(dir: string): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function resolveSkillsDir(options?: SkillStorageOptions): string {
  if (options?.skillsDir) {
    return ensureDirExists(options.skillsDir);
  }

  return ensureDirExists(getFactoryUserSkillsDir());
}

function normalizeSkillId(raw: unknown): string {
  if (typeof raw !== 'string') return '';

  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function assertValidSkillId(id: string): void {
  if (!SKILL_ID_PATTERN.test(id)) {
    throw new Error(
      'Skill id must be lowercase letters, numbers, or hyphens (1-64 chars, must start with letter/number)',
    );
  }
}

function normalizeStringRecord(raw: unknown): Record<string, string> {
  const normalized: Record<string, string> = {};

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return normalized;
  }

  for (const [key, value] of Object.entries(raw)) {
    normalized[key] = String(value);
  }

  return normalized;
}

function normalizeMetadata(raw: unknown): Record<string, string> {
  const metadata = normalizeStringRecord(raw);

  for (const key of RESERVED_METADATA_KEYS) {
    delete metadata[key];
  }

  if (!metadata.author) {
    metadata.author = 'pi-factory';
  }

  if (!metadata.version) {
    metadata.version = '1.0';
  }

  return metadata;
}

function parsePositiveInteger(raw: unknown, fieldName: string, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const parsed = typeof raw === 'number'
    ? raw
    : Number.parseInt(String(raw), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function normalizeConfigField(raw: unknown, index: number): SkillConfigField {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Config field #${index + 1} must be an object`);
  }

  const value = raw as Record<string, unknown>;

  const key = typeof value.key === 'string' ? value.key.trim() : '';
  if (!key) {
    throw new Error(`Config field #${index + 1} is missing key`);
  }

  if (!CONFIG_FIELD_KEY_PATTERN.test(key)) {
    throw new Error(
      `Config field "${key}" must contain only letters, numbers, underscores, or hyphens`,
    );
  }

  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (!label) {
    throw new Error(`Config field "${key}" is missing label`);
  }

  const type = typeof value.type === 'string' ? value.type.trim() : '';
  if (!ALLOWED_CONFIG_TYPES.has(type as SkillConfigField['type'])) {
    throw new Error(`Config field "${key}" has unsupported type: ${String(type)}`);
  }

  const defaultValue = value.default === undefined || value.default === null
    ? ''
    : String(value.default);

  const description = value.description === undefined || value.description === null
    ? ''
    : String(value.description);

  let validation: SkillConfigField['validation'] | undefined;

  if (value.validation !== undefined) {
    if (!value.validation || typeof value.validation !== 'object' || Array.isArray(value.validation)) {
      throw new Error(`Config field "${key}" validation must be an object`);
    }

    const rawValidation = value.validation as Record<string, unknown>;
    const parsedValidation: SkillConfigField['validation'] = {};

    if (rawValidation.min !== undefined && rawValidation.min !== null && String(rawValidation.min).trim() !== '') {
      const min = Number(rawValidation.min);
      if (!Number.isFinite(min)) {
        throw new Error(`Config field "${key}" validation.min must be a number`);
      }
      parsedValidation.min = min;
    }

    if (rawValidation.max !== undefined && rawValidation.max !== null && String(rawValidation.max).trim() !== '') {
      const max = Number(rawValidation.max);
      if (!Number.isFinite(max)) {
        throw new Error(`Config field "${key}" validation.max must be a number`);
      }
      parsedValidation.max = max;
    }

    if (rawValidation.pattern !== undefined && rawValidation.pattern !== null) {
      const pattern = String(rawValidation.pattern).trim();
      if (pattern) {
        parsedValidation.pattern = pattern;
      }
    }

    if (rawValidation.options !== undefined) {
      if (!Array.isArray(rawValidation.options)) {
        throw new Error(`Config field "${key}" validation.options must be an array`);
      }

      const options = rawValidation.options
        .map((option) => String(option).trim())
        .filter(Boolean);

      if (options.length > 0) {
        parsedValidation.options = Array.from(new Set(options));
      }
    }

    if (Object.keys(parsedValidation).length > 0) {
      validation = parsedValidation;
    }
  }

  if (type === 'select') {
    const options = validation?.options || [];
    if (options.length === 0) {
      throw new Error(`Config field "${key}" of type select requires validation.options`);
    }

    if (defaultValue && !options.includes(defaultValue)) {
      throw new Error(`Config field "${key}" default must be one of validation.options`);
    }

    validation = {
      ...(validation || {}),
      options,
    };
  }

  if (type === 'number' && defaultValue) {
    const parsedDefault = Number(defaultValue);
    if (!Number.isFinite(parsedDefault)) {
      throw new Error(`Config field "${key}" default must be numeric for number type`);
    }
  }

  return {
    key,
    label,
    type: type as SkillConfigField['type'],
    default: defaultValue,
    description,
    validation,
  };
}

function normalizeConfigSchema(raw: unknown): SkillConfigField[] {
  if (raw === undefined || raw === null) {
    return [];
  }

  if (!Array.isArray(raw)) {
    throw new Error('configSchema must be an array');
  }

  const fields = raw.map((field, index) => normalizeConfigField(field, index));
  const seenKeys = new Set<string>();

  for (const field of fields) {
    if (seenKeys.has(field.key)) {
      throw new Error(`Config field key "${field.key}" is duplicated`);
    }
    seenKeys.add(field.key);
  }

  return fields;
}

function parseType(raw: unknown): 'follow-up' | 'loop' {
  if (raw === 'loop') return 'loop';
  if (raw === 'follow-up') return 'follow-up';
  throw new Error('type must be either "follow-up" or "loop"');
}

function parseHooks(raw: unknown, fieldName = 'hooks'): SkillHook[] {
  if (raw === undefined || raw === null || raw === '') {
    return [...DEFAULT_SKILL_HOOKS];
  }

  const rawValues = Array.isArray(raw)
    ? raw.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : String(raw)
      .split(/[\s,]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  if (rawValues.length === 0) {
    throw new Error(`${fieldName} must include at least one of: pre, post`);
  }

  const invalid = rawValues.filter((value) => !SKILL_HOOK_SET.has(value as SkillHook));
  if (invalid.length > 0) {
    throw new Error(`${fieldName} contains unsupported hook(s): ${invalid.join(', ')}`);
  }

  return Array.from(new Set(rawValues as SkillHook[]));
}

function parseOptionalText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function parseOptionalPairedSkillId(raw: unknown): string | undefined {
  const normalized = normalizeSkillId(raw);
  if (!normalized) return undefined;
  assertValidSkillId(normalized);
  return normalized;
}

function normalizePromptTemplate(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('promptTemplate is required');
  }
  return raw.trim();
}

function normalizeDescription(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('description is required');
  }
  return raw.trim();
}

function normalizeSkillDefinition(raw: unknown): NormalizedSkillDefinition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Skill payload must be an object');
  }

  const payload = raw as Record<string, unknown>;

  const id = normalizeSkillId(payload.id);
  if (!id) {
    throw new Error('id is required');
  }
  assertValidSkillId(id);

  const description = normalizeDescription(payload.description);
  const type = parseType(payload.type);
  const promptTemplate = normalizePromptTemplate(payload.promptTemplate);
  const maxIterations = parsePositiveInteger(payload.maxIterations, 'maxIterations', 1);

  const doneSignalRaw = payload.doneSignal;
  const doneSignal = typeof doneSignalRaw === 'string' && doneSignalRaw.trim().length > 0
    ? doneSignalRaw.trim()
    : DEFAULT_DONE_SIGNAL;

  const metadataRaw = normalizeStringRecord(payload.metadata);
  const hooks = parseHooks(payload.hooks ?? metadataRaw.hooks, 'hooks');
  const workflowId = parseOptionalText(payload.workflowId ?? metadataRaw['workflow-id']);
  const pairedSkillId = parseOptionalPairedSkillId(payload.pairedSkillId ?? metadataRaw['pairs-with']);

  const configSchema = normalizeConfigSchema(payload.configSchema);
  const metadata = normalizeMetadata(payload.metadata);

  return {
    id,
    description,
    type,
    hooks,
    workflowId,
    pairedSkillId,
    maxIterations,
    doneSignal,
    promptTemplate,
    configSchema,
    metadata,
  };
}

export function parseImportedSkillMarkdown(content: string): NormalizedSkillDefinition {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('content is required');
  }

  const normalizedContent = content.replace(/\r\n/g, '\n');
  const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error('Imported skill must include YAML frontmatter');
  }

  const [, yamlContent, bodyContent] = frontmatterMatch;
  const parsed = YAML.parse(yamlContent) as Record<string, unknown> | null;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Skill frontmatter must parse to an object');
  }

  const id = normalizeSkillId(parsed.name);
  if (!id) {
    throw new Error('Skill frontmatter is missing a valid name');
  }
  assertValidSkillId(id);

  const description = normalizeDescription(parsed.description);
  const metadataRaw = normalizeStringRecord(parsed.metadata);

  const type = metadataRaw.type === 'loop' ? 'loop' : 'follow-up';
  const hooks = parseHooks(metadataRaw.hooks, 'metadata.hooks');
  const workflowId = parseOptionalText(metadataRaw['workflow-id']);
  const pairedSkillId = parseOptionalPairedSkillId(metadataRaw['pairs-with']);
  const maxIterations = parsePositiveInteger(metadataRaw['max-iterations'], 'metadata.max-iterations', 1);

  const doneSignal = metadataRaw['done-signal']
    ? String(metadataRaw['done-signal']).trim()
    : DEFAULT_DONE_SIGNAL;

  const promptTemplate = normalizePromptTemplate(bodyContent);

  const configSchema = normalizeConfigSchema(parsed.config);
  const metadata = normalizeMetadata(metadataRaw);

  return {
    id,
    description,
    type,
    hooks,
    workflowId,
    pairedSkillId,
    maxIterations,
    doneSignal,
    promptTemplate,
    configSchema,
    metadata,
  };
}

export function buildSkillMarkdown(definition: NormalizedSkillDefinition): string {
  const metadata: Record<string, string> = {
    ...definition.metadata,
    type: definition.type,
    hooks: definition.hooks.join(','),
  };

  if (definition.workflowId) {
    metadata['workflow-id'] = definition.workflowId;
  }

  if (definition.pairedSkillId) {
    metadata['pairs-with'] = definition.pairedSkillId;
  }

  if (definition.type === 'loop') {
    metadata['max-iterations'] = String(definition.maxIterations);
    metadata['done-signal'] = definition.doneSignal;
  }

  const frontmatter: Record<string, unknown> = {
    name: definition.id,
    description: definition.description,
    metadata,
  };

  if (definition.configSchema.length > 0) {
    frontmatter.config = definition.configSchema.map((field) => {
      const serialized: Record<string, unknown> = {
        key: field.key,
        label: field.label,
        type: field.type,
        default: field.default,
        description: field.description,
      };

      if (field.validation && Object.keys(field.validation).length > 0) {
        serialized.validation = field.validation;
      }

      return serialized;
    });
  }

  const yaml = YAML.stringify(frontmatter).trimEnd();
  const body = definition.promptTemplate.trim();

  return `---\n${yaml}\n---\n\n${body}\n`;
}

export function createFactorySkill(rawInput: unknown, options?: SkillStorageOptions): string {
  const input = normalizeSkillDefinition(rawInput);
  const skillsDir = resolveSkillsDir(options);
  const skillDir = join(skillsDir, input.id);

  if (existsSync(skillDir)) {
    throw new Error(`Skill "${input.id}" already exists`);
  }

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), buildSkillMarkdown(input), 'utf-8');

  return input.id;
}

export function updateFactorySkill(skillId: string, rawInput: unknown, options?: SkillStorageOptions): string {
  const normalizedSkillId = normalizeSkillId(skillId);
  if (!normalizedSkillId || normalizedSkillId !== skillId) {
    throw new Error('Invalid skill id in path');
  }

  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Skill payload must be an object');
  }

  const payload = rawInput as Record<string, unknown>;

  if (payload.id !== undefined) {
    const requestedId = normalizeSkillId(payload.id);
    if (requestedId !== skillId) {
      throw new Error('Renaming skill id is not supported. Create a new skill instead.');
    }
  }

  const input = normalizeSkillDefinition({
    ...payload,
    id: skillId,
  });

  const skillsDir = resolveSkillsDir(options);
  const skillDir = join(skillsDir, skillId);

  if (!existsSync(skillDir)) {
    throw new Error(`Skill "${skillId}" does not exist`);
  }

  writeFileSync(join(skillDir, 'SKILL.md'), buildSkillMarkdown(input), 'utf-8');

  return skillId;
}

export function importFactorySkill(
  content: string,
  overwrite = false,
  options?: SkillStorageOptions,
): string {
  const parsed = parseImportedSkillMarkdown(content);
  const skillsDir = resolveSkillsDir(options);
  const skillDir = join(skillsDir, parsed.id);

  if (existsSync(skillDir) && !overwrite) {
    throw new Error(`Skill "${parsed.id}" already exists. Enable overwrite to replace it.`);
  }

  if (existsSync(skillDir) && overwrite) {
    rmSync(skillDir, { recursive: true, force: true });
  }

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), buildSkillMarkdown(parsed), 'utf-8');

  return parsed.id;
}

export function deleteFactorySkill(skillId: string, options?: SkillStorageOptions): void {
  const normalizedSkillId = normalizeSkillId(skillId);
  if (!normalizedSkillId || normalizedSkillId !== skillId) {
    throw new Error('Invalid skill id');
  }

  const skillsDir = resolveSkillsDir(options);
  const skillDir = join(skillsDir, skillId);

  if (!existsSync(skillDir)) {
    throw new Error(`Skill "${skillId}" does not exist`);
  }

  rmSync(skillDir, { recursive: true, force: false });
}
