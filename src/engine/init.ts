import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureNestAppModuleAnchors } from './anchors.js';
import {
  defaultConfigForStack,
  detectAppModulePath,
  detectStack,
} from './config.js';
import { JoyConfig, JoyError } from './types.js';

export interface InitOptions {
  dryRun?: boolean;
}

export interface InitResult {
  stack: 'sveltekit' | 'nest';
  config: JoyConfig;
  touchedFiles: string[];
}

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

  // 2. If nest stack, install AppModule anchors idempotently
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

  // 3. Write joy.config.json
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

  return { stack, config, touchedFiles };
}
