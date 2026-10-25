import * as fs from 'node:fs';
import * as path from 'node:path';
import { JoyConfig, JoyLock, LockEntry } from './types.js';

export const APP_MODULE_CANDIDATES = [
  'src/app.module.ts',
  'src/modules/main/app.module.ts',
  'src/modules/app/app.module.ts',
];

export function detectAppModulePath(cwd: string): string {
  for (const candidate of APP_MODULE_CANDIDATES) {
    if (fs.existsSync(path.join(cwd, candidate))) {
      return candidate;
    }
  }
  return 'src/app.module.ts';
}

export function detectStack(cwd: string): 'sveltekit' | 'nest' | null {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    if (allDeps['@sveltejs/kit'] || allDeps['svelte']) {
      return 'sveltekit';
    }
    if (allDeps['@nestjs/core'] || allDeps['@nestjs/common']) {
      return 'nest';
    }
    return null;
  } catch {
    return null;
  }
}

export function defaultConfigForStack(
  cwd: string,
  stack: 'sveltekit' | 'nest'
): JoyConfig {
  const pkgPath = path.join(cwd, 'package.json');
  let scripts: Record<string, string> = {};
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      scripts = pkg.scripts ?? {};
    } catch {
      scripts = {};
    }
  }

  if (stack === 'sveltekit') {
    const verify: string[] = [];
    if (scripts['check']) verify.push('pnpm check');
    if (scripts['test:unit']) verify.push('pnpm test:unit --run');
    return {
      packs: ['sveltekit'],
      paths: {
        routes: 'src/routes',
        components: 'src/lib/components',
      },
      verify,
      anchors: {},
    };
  }

  const appModule = detectAppModulePath(cwd);
  const verify: string[] = [];
  if (scripts['build']) verify.push('pnpm build');
  if (scripts['test']) verify.push('pnpm test');
  return {
    packs: ['nest'],
    paths: {
      modules: 'src/modules',
    },
    verify,
    anchors: {
      'app-module-imports': appModule,
      'app-module-declarations': appModule,
    },
  };
}

export function loadJoyConfig(cwd: string): JoyConfig {
  const configPath = path.join(cwd, 'joy.config.json');
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<JoyConfig>;
    const stack = raw.packs?.[0] ?? detectStack(cwd) ?? 'sveltekit';
    const def = defaultConfigForStack(cwd, stack);
    return {
      packs: raw.packs ?? def.packs,
      paths: { ...def.paths, ...(raw.paths ?? {}) },
      verify: raw.verify ?? def.verify,
      anchors: { ...def.anchors, ...(raw.anchors ?? {}) },
    };
  }
  const detected = detectStack(cwd) ?? 'sveltekit';
  return defaultConfigForStack(cwd, detected);
}

export function appendLockEntry(cwd: string, entry: LockEntry): void {
  const lockDir = path.join(cwd, '.joy');
  const lockPath = path.join(lockDir, 'lock.json');
  fs.mkdirSync(lockDir, { recursive: true });
  let lock: JoyLock = { entries: [] };
  if (fs.existsSync(lockPath)) {
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as JoyLock;
      if (!Array.isArray(lock.entries)) lock.entries = [];
    } catch {
      lock = { entries: [] };
    }
  }
  const existingIdx = lock.entries.findIndex(
    (e) => e.generator === entry.generator && e.target === entry.target
  );
  if (existingIdx !== -1) {
    lock.entries[existingIdx] = entry;
  } else {
    lock.entries.push(entry);
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}
