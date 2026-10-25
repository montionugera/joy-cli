import * as fs from 'node:fs';
import * as path from 'node:path';
import { JoyConfig, JoyLock, LockEntry } from './types.js';

export const APP_MODULE_CANDIDATES = [
  'src/app.module.ts',
  'src/modules/main/app.module.ts',
  'src/modules/app/app.module.ts',
  'user-api/src/app.module.ts',
];

export function detectAppModulePath(cwd: string): string {
  for (const candidate of APP_MODULE_CANDIDATES) {
    if (fs.existsSync(path.join(cwd, candidate))) {
      return candidate;
    }
  }
  return 'src/app.module.ts';
}

export function detectStack(cwd: string): 'sveltekit' | 'nest' | 'joy-design-internal' | null {
  if (
    fs.existsSync(path.join(cwd, 'packages/svelte/src/lib/index.ts')) &&
    fs.existsSync(path.join(cwd, 'packages/react/src/index.ts')) &&
    fs.existsSync(path.join(cwd, 'scripts/parity-check.mjs'))
  ) {
    return 'joy-design-internal';
  }
  const pkgPaths = [
    path.join(cwd, 'package.json'),
    path.join(cwd, 'user-api/package.json'),
  ];
  for (const pkgPath of pkgPaths) {
    if (!fs.existsSync(pkgPath)) continue;
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
    } catch {
      // ignore
    }
  }
  return null;
}

export function hasPackageDep(cwd: string, depName: string): boolean {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    return Boolean(allDeps[depName]);
  } catch {
    return false;
  }
}

export function defaultConfigForStack(
  cwd: string,
  stack: 'sveltekit' | 'nest' | 'joy-design-internal'
): JoyConfig {
  if (stack === 'joy-design-internal') {
    return {
      packs: ['joy-design-internal'],
      paths: {
        components: 'packages/svelte/src/lib',
      },
      verify: [
        'node packages/tokens/build.js',
        'node scripts/parity-check.mjs',
        'node scripts/parity-check.mjs --triplet',
        'node scripts/gen-design-md.mjs',
        'node scripts/gen-design-md.mjs --check',
        'bash scripts/lint-colors.sh',
        'pnpm check',
      ],
      anchors: {
        exports: 'packages/svelte/src/lib/index.ts',
        components: 'scripts/parity-check.mjs',
        'ref-forwarding': 'scripts/parity-check.mjs',
        'svelte-ref-rest': 'scripts/parity-check.mjs',
        contract: 'scripts/parity-check.mjs',
        'component-styles-end': 'packages/tokens/build.js',
      },
    };
  }
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
  return {
    packs: ['nest'],
    paths: {
      modules: appModule.startsWith('user-api/') ? 'user-api/src/modules' : 'src/modules',
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

export function readLock(cwd: string): JoyLock {
  const lockPath = path.join(cwd, '.joy/lock.json');
  if (!fs.existsSync(lockPath)) return { entries: [] };
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as JoyLock;
    return Array.isArray(lock.entries) ? lock : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

export function appendLockEntry(cwd: string, entry: LockEntry): void {
  const lockDir = path.join(cwd, '.joy');
  const lockPath = path.join(lockDir, 'lock.json');
  fs.mkdirSync(lockDir, { recursive: true });
  const lock = readLock(cwd);
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
