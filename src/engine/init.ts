import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { ensureNestAppModuleAnchors } from './anchors.js';
import { installJoyDesignAnchors } from '../packs/joy-design-internal/index.js';
import {
  defaultConfigForStack,
  detectAppModulePath,
  detectStack,
} from './config.js';
import { JoyConfig, JoyError } from './types.js';

export interface InitOptions {
  dryRun?: boolean;
  installDeps?: boolean;
}

export interface InitResult {
  stack: 'sveltekit' | 'nest' | 'joy-design-internal';
  config: JoyConfig;
  touchedFiles: string[];
}

const INTERNAL_DEPS_BY_STACK: Record<
  'sveltekit' | 'nest',
  { dependencies: Record<string, string>; devDependencies: Record<string, string> }
> = {
  sveltekit: {
    dependencies: {
      '@montionugera/joy-svelte': '^0.2.1',
      '@montionugera/joy-tokens': '^0.2.1',
      '@montionugera/joy-icons': '^0.3.0',
      '@montionugera/joy-brand': '^0.2.0',
    },
    devDependencies: {
      '@montionugera/joy-cli': '^0.1.5',
    },
  },
  nest: {
    dependencies: {
      '@montionugera/entity-spec': '^2.0.28',
      '@montionugera/entity-spec-gen-zod': '^2.0.28',
      '@montionugera/entity-spec-gen-openapi': '^2.0.28',
      '@montionugera/server-decorator': '^2.0.28',
      zod: '^3.23.8',
    },
    devDependencies: {
      '@montionugera/joy-cli': '^0.1.3',
    },
  },
};

export function runInit(cwd: string, opts: InitOptions = {}): InitResult {
  const stack = detectStack(cwd);
  if (!stack) {
    throw new JoyError(
      'E_USAGE',
      `Could not detect stack (sveltekit or nest) from package.json in ${cwd}`,
      2
    );
  }

  const config = defaultConfigForStack(cwd, stack);
  const touchedFiles: string[] = [];

  // 1. Ensure .npmrc has @montionugera:registry=https://npm.pkg.github.com
  const npmrcPath = path.join(cwd, '.npmrc');
  const registryLine = '@montionugera:registry=https://npm.pkg.github.com';
  const existingNpmrc = fs.existsSync(npmrcPath)
    ? fs.readFileSync(npmrcPath, 'utf8')
    : '';
  if (!existingNpmrc.includes('@montionugera:registry=')) {
    touchedFiles.push('.npmrc');
    if (!opts.dryRun) {
      const nextNpmrc = existingNpmrc
        ? `${existingNpmrc.trimEnd()}\n${registryLine}\n`
        : `${registryLine}\n`;
      fs.writeFileSync(npmrcPath, nextNpmrc, 'utf8');
    }
  }

  // 2. Ensure internal @montionugera/* libraries and @montionugera/joy-cli are declared in package.json
  const pkgPath = path.join(cwd, 'package.json');
  if ((stack === 'sveltekit' || stack === 'nest') && fs.existsSync(pkgPath)) {
    const rawPkg = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(rawPkg) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      [k: string]: unknown;
    };
    const required = INTERNAL_DEPS_BY_STACK[stack];
    let pkgChanged = false;
    pkg.dependencies = pkg.dependencies ?? {};
    pkg.devDependencies = pkg.devDependencies ?? {};

    for (const [dep, ver] of Object.entries(required.dependencies)) {
      if (!pkg.dependencies[dep] && !pkg.devDependencies[dep]) {
        pkg.dependencies[dep] = ver;
        pkgChanged = true;
      }
    }
    for (const [dep, ver] of Object.entries(required.devDependencies)) {
      if (!pkg.dependencies[dep] && !pkg.devDependencies[dep]) {
        pkg.devDependencies[dep] = ver;
        pkgChanged = true;
      }
    }

    if (pkgChanged) {
      touchedFiles.push('package.json');
      if (!opts.dryRun) {
        fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
      }
    }
  }

  // 3a. If joy-design-internal stack, install all 6 component/parity/CSS anchors idempotently
  if (stack === 'joy-design-internal') {
    const jdTouched = installJoyDesignAnchors(cwd, Boolean(opts.dryRun));
    touchedFiles.push(...jdTouched);
  }

  // 3b. If nest stack, install AppModule anchors idempotently
  if (stack === 'nest') {
    const appModuleRel = detectAppModulePath(cwd);
    const appModuleAbs = path.join(cwd, appModuleRel);
    if (fs.existsSync(appModuleAbs)) {
      const raw = fs.readFileSync(appModuleAbs, 'utf8');
      const updated = ensureNestAppModuleAnchors(raw);
      if (updated !== raw) {
        touchedFiles.push(appModuleRel);
        if (!opts.dryRun) {
          fs.writeFileSync(appModuleAbs, updated, 'utf8');
        }
      }
    }
  }

  // 4. Write joy.config.json
  const configPath = path.join(cwd, 'joy.config.json');
  const renderedConfig = `${JSON.stringify(config, null, 2)}\n`;
  const existingConfig = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, 'utf8')
    : '';
  if (existingConfig !== renderedConfig) {
    touchedFiles.push('joy.config.json');
    if (!opts.dryRun) {
      fs.writeFileSync(configPath, renderedConfig, 'utf8');
    }
  }

  // 5. Optional --install-deps runs pnpm install to fetch newly declared internal packages
  if (opts.installDeps && !opts.dryRun) {
    execSync('pnpm install', { cwd, stdio: 'inherit' });
  }

  return { stack, config, touchedFiles };
}
