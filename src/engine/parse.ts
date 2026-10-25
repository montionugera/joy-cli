import {
  FieldDef,
  FieldType,
  JoyError,
  ParsedCliArgs,
  PropDef,
  PropType,
} from './types.js';

const VALID_FIELD_TYPES = new Set<FieldType>([
  'str',
  'email',
  'uuid',
  'uri',
  'int',
  'float',
  'bool',
  'datetime',
  'enum',
]);

const VALID_PROP_TYPES = new Set<PropType>([
  'string',
  'number',
  'boolean',
  'array',
  'enum',
]);

export function parseFields(raw?: string): FieldDef[] {
  if (!raw || !raw.trim()) return [];
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return entries.map((entry) => {
    let defaultValue: string | undefined;
    let mainPart = entry;
    const eqIdx = entry.indexOf('=');
    if (eqIdx !== -1) {
      mainPart = entry.slice(0, eqIdx).trim();
      defaultValue = entry.slice(eqIdx + 1).trim();
    }

    const colonIdx = mainPart.indexOf(':');
    if (colonIdx === -1) {
      throw new JoyError(
        'E_USAGE',
        `Invalid field syntax "${entry}". Expected <name>:<type>[=default]`,
        2
      );
    }

    let name = mainPart.slice(0, colonIdx).trim();
    let optional = false;
    if (name.endsWith('?')) {
      optional = true;
      name = name.slice(0, -1);
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new JoyError('E_USAGE', `Invalid field name "${name}"`, 2);
    }
    if (name === 'id') {
      throw new JoyError(
        'E_USAGE',
        `Field "id" is automatically generated as primary key; do not pass it in --fields`,
        2
      );
    }

    const rawType = mainPart.slice(colonIdx + 1).trim();
    const enumMatch = /^enum\(([^)]+)\)$/.exec(rawType);
    if (enumMatch) {
      const enumValues = enumMatch[1]
        .split('|')
        .map((v) => v.trim())
        .filter(Boolean);
      if (enumValues.length === 0) {
        throw new JoyError('E_USAGE', `Empty enum values in "${entry}"`, 2);
      }
      return {
        name,
        type: 'enum',
        optional,
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        enumValues,
      };
    }

    if (!VALID_FIELD_TYPES.has(rawType as FieldType)) {
      throw new JoyError(
        'E_USAGE',
        `Invalid field type "${rawType}" in "${entry}". Allowed: str, email, uuid, uri, int, float, bool, datetime, enum(a|b)`,
        2
      );
    }

    return {
      name,
      type: rawType as FieldType,
      optional,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    };
  });
}

export function extractFieldsFromEntitySpecSource(source: string): FieldDef[] {
  const fields: FieldDef[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const decMatch = /^@(?:field\()?([a-zA-Z]+)\((.*?)\)\)?$/.exec(line);
    if (!decMatch) continue;
    const fnName = decMatch[1];
    if (fnName === 'id') continue;
    const argsStr = decMatch[2];
    const nextLine = (lines[i + 1] ?? '').trim();
    const propMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*!\s*:\s*([^;]+?)(?:\s*=\s*([^;]+))?;/.exec(
      nextLine
    ) || /^([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*:\s*([^;=]+?)(?:\s*=\s*([^;]+))?;/.exec(nextLine);
    if (!propMatch) continue;
    const name = propMatch[1];
    const optional = Boolean(propMatch[2]) || argsStr.includes('optional: true');
    const rawDefault = propMatch[4]?.trim().replace(/^['"]|['"]$/g, '');

    if (fnName === 'enumOf') {
      const arrMatch = /\[([^\]]+)\]/.exec(argsStr);
      const enumValues = arrMatch
        ? arrMatch[1]
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
        : ['default'];
      fields.push({
        name,
        type: 'enum',
        optional,
        ...(rawDefault !== undefined ? { defaultValue: rawDefault } : {}),
        enumValues,
      });
    } else if (VALID_FIELD_TYPES.has(fnName as FieldType)) {
      fields.push({
        name,
        type: fnName as FieldType,
        optional,
        ...(rawDefault !== undefined ? { defaultValue: rawDefault } : {}),
      });
    }
  }
  return fields;
}

export function parseProps(raw?: string): PropDef[] {
  if (!raw || !raw.trim()) return [];
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return entries.map((entry) => {
    let defaultValue: string | undefined;
    let mainPart = entry;
    const eqIdx = entry.indexOf('=');
    if (eqIdx !== -1) {
      mainPart = entry.slice(0, eqIdx).trim();
      defaultValue = entry.slice(eqIdx + 1).trim();
    }

    const colonIdx = mainPart.indexOf(':');
    if (colonIdx === -1) {
      throw new JoyError(
        'E_USAGE',
        `Invalid prop syntax "${entry}". Expected <name>:<type>[=default]`,
        2
      );
    }

    let name = mainPart.slice(0, colonIdx).trim();
    let optional = defaultValue !== undefined;
    if (name.endsWith('?')) {
      optional = true;
      name = name.slice(0, -1);
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new JoyError('E_USAGE', `Invalid prop name "${name}"`, 2);
    }

    const rawType = mainPart.slice(colonIdx + 1).trim();
    const enumMatch = /^enum\(([^)]+)\)$/.exec(rawType);
    if (enumMatch) {
      const enumValues = enumMatch[1]
        .split('|')
        .map((v) => v.trim())
        .filter(Boolean);
      if (enumValues.length === 0) {
        throw new JoyError('E_USAGE', `Empty enum values in "${entry}"`, 2);
      }
      return {
        name,
        type: 'enum',
        optional,
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        enumValues,
      };
    }

    if (!VALID_PROP_TYPES.has(rawType as PropType)) {
      throw new JoyError(
        'E_USAGE',
        `Invalid prop type "${rawType}" in "${entry}". Allowed: string, number, boolean, array, enum(a|b)`,
        2
      );
    }

    return {
      name,
      type: rawType as PropType,
      optional,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    };
  });
}

export function parseEvents(raw?: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((ev) => {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(ev)) {
        throw new JoyError('E_USAGE', `Invalid event name "${ev}"`, 2);
      }
      return ev;
    });
}

export function parseSizes(raw?: string): string[] {
  if (!raw || !raw.trim()) return ['sm', 'md', 'lg'];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const result: ParsedCliArgs = {
    command: 'help',
    orm: 'typeorm',
    installDeps: false,
    dryRun: false,
    force: false,
    regen: false,
    check: false,
    json: false,
    keepOnFail: false,
    noVerify: false,
    strict: false,
  };

  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--install-deps') {
      result.installDeps = true;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--regen') {
      result.regen = true;
    } else if (arg === '--check') {
      result.check = true;
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--keep-on-fail') {
      result.keepOnFail = true;
    } else if (arg === '--no-verify') {
      result.noVerify = true;
    } else if (arg === '--strict') {
      result.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      result.command = 'help';
      return result;
    } else if (arg.startsWith('--fields=')) {
      result.fields = arg.slice('--fields='.length);
    } else if (arg === '--fields') {
      result.fields = argv[++i];
    } else if (arg.startsWith('--props=')) {
      result.props = arg.slice('--props='.length);
    } else if (arg === '--props') {
      result.props = argv[++i];
    } else if (arg.startsWith('--events=')) {
      result.events = arg.slice('--events='.length);
    } else if (arg === '--events') {
      result.events = argv[++i];
    } else if (arg.startsWith('--sizes=')) {
      result.sizes = arg.slice('--sizes='.length);
    } else if (arg === '--sizes') {
      result.sizes = argv[++i];
    } else if (arg.startsWith('--orm=')) {
      const val = arg.slice('--orm='.length);
      if (val !== 'typeorm' && val !== 'prisma') {
        throw new JoyError('E_USAGE', `Invalid --orm="${val}". Expected typeorm or prisma`, 2);
      }
      result.orm = val;
    } else if (arg === '--orm') {
      const val = argv[++i];
      if (val !== 'typeorm' && val !== 'prisma') {
        throw new JoyError('E_USAGE', `Invalid --orm="${val}". Expected typeorm or prisma`, 2);
      }
      result.orm = val;
    } else if (arg.startsWith('-')) {
      throw new JoyError('E_USAGE', `Unknown flag "${arg}"`, 2);
    } else {
      positionals.push(arg);
    }
  }

  const cmd = positionals[0];
  if (!cmd || cmd === 'help') {
    result.command = 'help';
    return result;
  }
  if (cmd === 'init') {
    result.command = 'init';
    return result;
  }
  if (cmd === 'doctor') {
    result.command = 'doctor';
    return result;
  }
  if (cmd === 'verify') {
    result.command = 'verify';
    result.generator = positionals[1];
    result.target = positionals[2];
    if (!result.generator || !result.target) {
      throw new JoyError('E_USAGE', 'Usage: joy verify <generator> <Name>', 2);
    }
    return result;
  }
  if (cmd === 'g' || cmd === 'generate') {
    result.command = 'generate';
    result.generator = positionals[1];
    result.target = positionals[2];
    if (!result.generator || !result.target) {
      throw new JoyError('E_USAGE', 'Usage: joy g <generator> <Name> [options]', 2);
    }
    return result;
  }

  throw new JoyError('E_USAGE', `Unknown command "${cmd}"`, 2);
}
