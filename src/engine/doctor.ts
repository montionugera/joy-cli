import * as fs from 'node:fs';
import * as path from 'node:path';
import { hasAnchor } from './anchors.js';
import { loadJoyConfig } from './config.js';
import { JoyError, JoyLock, PackDef } from './types.js';

export interface DoctorResult {
  ok: boolean;
  warnings: string[];
}

function parseMajor(ver: string): number | null {
  const cleaned = ver.replace(/^[\^~>=<v\s]+/, '');
  const m = /^(\d+)/.exec(cleaned);
  return m ? Number(m[1]) : null;
}

export function semverSatisfies(installed: string, range: string): boolean {
  if (installed === 'workspace:*') return true;
  const instMajor = parseMajor(installed);
  if (instMajor === null) return true;
  const alternatives = range.split('||').map((s) => s.trim());
  return alternatives.some((alt) => {
    const reqMajor = parseMajor(alt);
    return reqMajor === null || instMajor === reqMajor;
  });
}

export function runDoctor(
  cwd: string,
  packs: Record<string, PackDef>,
  opts: { strict?: boolean } = {}
): DoctorResult {
  const warnings: string[] = [];
  const config = loadJoyConfig(cwd);

  // 1. Check .npmrc for @montionugera:registry
  const npmrcPath = path.join(cwd, '.npmrc');
  if (
    !fs.existsSync(npmrcPath) ||
    !fs.readFileSync(npmrcPath, 'utf8').includes('@montionugera:registry=')
  ) {
    warnings.push(
      'Missing "@montionugera:registry=https://npm.pkg.github.com" in .npmrc (run "joy init").'
    );
  }

  // 2. Check installed package versions against pack compat
  const pkgPath = path.join(cwd, 'package.json');
  const allDeps: Record<string, string> = {};
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      Object.assign(allDeps, pkg.dependencies ?? {}, pkg.devDependencies ?? {});
    } catch {
      // ignore
    }
  }

  for (const packName of config.packs) {
    const pack = packs[packName];
    if (!pack) continue;
    for (const [depName, reqRange] of Object.entries(pack.compat)) {
      const installed = allDeps[depName];
      if (!installed) {
        warnings.push(
          `Pack "${packName}" expects "${depName}@${reqRange}" (not found in package.json).`
        );
      } else if (!semverSatisfies(installed, reqRange)) {
        warnings.push(
          `Pack "${packName}" requires "${depName}@${reqRange}", found "${installed}".`
        );
      }
    }
  }

  // 3. Check configured anchors
  for (const [anchorName, relFile] of Object.entries(config.anchors)) {
    const absFile = path.join(cwd, relFile);
    if (!fs.existsSync(absFile)) {
      warnings.push(`Anchor target file "${relFile}" for "${anchorName}" does not exist.`);
    } else {
      const content = fs.readFileSync(absFile, 'utf8');
      if (!hasAnchor(content, anchorName)) {
        warnings.push(`Missing anchor "${anchorName}" in "${relFile}" (run "joy init").`);
      }
    }
  }

  // 4. Check .joy/lock.json template version drift
  const lockPath = path.join(cwd, '.joy/lock.json');
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as JoyLock;
      for (const entry of lock.entries ?? []) {
        const pack = packs[entry.pack];
        if (pack && entry.packVersion !== pack.version) {
          warnings.push(
            `Template drift: "${entry.generator} ${entry.target}" was generated with ${entry.pack}@${entry.packVersion} (current: ${pack.version}).`
          );
        }
      }
    } catch {
      warnings.push('Could not parse .joy/lock.json.');
    }
  }

  if (opts.strict && warnings.length > 0) {
    throw new JoyError(
      'E_DOCTOR_FAILED',
      `Doctor found ${warnings.length} issue(s):\n- ${warnings.join('\n- ')}`,
      1
    );
  }

  return {
    ok: warnings.length === 0,
    warnings,
  };
}
