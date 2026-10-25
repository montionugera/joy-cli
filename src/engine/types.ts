export type ErrorCode =
  | 'E_USAGE'
  | 'E_EXISTS'
  | 'E_DRIFT'
  | 'E_ANCHOR_MISSING'
  | 'E_TARGET_MISSING'
  | 'E_VERIFY_FAILED'
  | 'E_DOCTOR_FAILED';

export type ExitCode = 0 | 1 | 2;

export class JoyError extends Error {
  public readonly code: ErrorCode;
  public readonly exitCode: 1 | 2;

  constructor(code: ErrorCode, message: string, exitCode: 1 | 2) {
    super(`${code}: ${message}`);
    this.name = 'JoyError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export type FieldType =
  | 'str'
  | 'email'
  | 'uuid'
  | 'uri'
  | 'int'
  | 'float'
  | 'bool'
  | 'datetime'
  | 'enum';

export interface FieldDef {
  name: string;
  type: FieldType;
  optional: boolean;
  defaultValue?: string;
  enumValues?: string[];
}

export type PropType = 'string' | 'number' | 'boolean' | 'array' | 'enum';

export interface PropDef {
  name: string;
  type: PropType;
  optional: boolean;
  defaultValue?: string;
  enumValues?: string[];
}

export interface ParsedCliArgs {
  command: 'init' | 'doctor' | 'verify' | 'generate' | 'help';
  generator?: string;
  target?: string;
  fields?: string;
  props?: string;
  events?: string;
  sizes?: string;
  orm: 'typeorm' | 'prisma';
  installDeps: boolean;
  dryRun: boolean;
  force: boolean;
  regen: boolean;
  check: boolean;
  json: boolean;
  keepOnFail: boolean;
  noVerify: boolean;
  strict: boolean;
}

export interface CreateFileAction {
  relPath: string;
  content: string;
  generated?: boolean;
  isTest?: boolean;
}

export interface EditFileAction {
  relPath: string;
  content: string;
}

export interface PlanResult {
  creates: CreateFileAction[];
  edits: EditFileAction[];
  testFiles?: string[];
}

export interface JoyConfig {
  packs: ('sveltekit' | 'nest')[];
  paths: {
    routes?: string;
    components?: string;
    modules?: string;
  };
  verify: string[];
  anchors: Record<string, string>;
}

export interface LockEntry {
  generator: string;
  pack: string;
  packVersion: string;
  target: string;
  fields?: string;
  props?: string;
  events?: string;
  sizes?: string;
  files: string[];
  at: string;
}

export interface JoyLock {
  entries: LockEntry[];
}

export interface GeneratorContext {
  cwd: string;
  target: string;
  args: ParsedCliArgs;
  config: JoyConfig;
}

export interface GeneratorDef {
  name: string;
  description: string;
  expectedPaths(ctx: GeneratorContext): string[];
  plan(ctx: GeneratorContext): PlanResult;
}

export interface PackDef {
  name: 'sveltekit' | 'nest';
  version: string;
  compat: Record<string, string>;
  generators: Record<string, GeneratorDef>;
}
