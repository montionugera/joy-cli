import * as fs from 'node:fs';
import * as path from 'node:path';
import { hasAnchor } from './anchors.js';
import { loadJoyConfig, readLock } from './config.js';
import {
  GeneratorContext,
  JoyError,
  PackDef,
  ParsedCliArgs,
} from './types.js';

export interface DoctorResult {
  ok: boolean;
  warnings: string[];
  diffs: Record<string, string>;
}

export interface VerifyEntryResult {
  relPath: string;
  ok: boolean;
  reason?: string;
}

function parseMajor(ver: string): number | null {
  const cleaned = ver.replace(/^[\^~>=<v\s]+/, '');
  const m = /^(\d+)/.exec(cleaned);
  return m ? Number(m[1]) : null;
}

export function semverSatisfies(installed: string, range: string): boolean {
  if (installed === 'workspace:*' || installed.startsWith('file:') || installed.startsWith('link:')) {
    return true;
  }
  const instMajor = parseMajor(installed);
  if (instMajor === null) return true;
  const alternatives = range.split('||').map((s) => s.trim());
  return alternatives.some((alt) => {
    const reqMajor = parseMajor(alt);
    return reqMajor === null || instMajor === reqMajor;
  });
}

function unifiedSnippetDiff(relPath: string, diskContent: string, expectedContent: string): string {
  if (diskContent === expectedContent) return '';
  return `--- a/${relPath} (disk)\n+++ b/${relPath} (template)\n@@\n-${diskContent.split('\n')[0] ?? ''}\n+${expectedContent.split('\n')[0] ?? ''}`;
}

export function runDoctor(
  cwd: string,
  packs: Record<string, PackDef>,
  opts: { strict?: boolean } = {}
): DoctorResult {
  const warnings: string[] = [];
  const diffs: Record<string, string> = {};
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

  // 4. Check .joy/lock.json template version drift & print template diff
  const lock = readLock(cwd);
  for (const entry of lock.entries) {
    const pack = packs[entry.pack];
    if (!pack) continue;
    const gen = pack.generators[entry.generator];
    if (entry.packVersion !== pack.version) {
      warnings.push(
        `Template drift: "${entry.generator} ${entry.target}" was generated with ${entry.pack}@${entry.packVersion} (current: ${pack.version}).`
      );
    }
    if (gen) {
      try {
        const synthArgs: ParsedCliArgs = {
          command: 'generate',
          generator: entry.generator,
          target: entry.target,
          fields: entry.fields,
          props: entry.props,
          events: entry.events,
          sizes: entry.sizes,
          orm: 'typeorm',
          installDeps: false,
          dryRun: true,
          force: false,
          regen: false,
          check: false,
          json: false,
          keepOnFail: false,
          noVerify: true,
          strict: false,
        };
        const plan = gen.plan({ cwd, target: entry.target, args: synthArgs, config });
        for (const c of plan.creates) {
          const abs = path.join(cwd, c.relPath);
          if (fs.existsSync(abs)) {
            const disk = fs.readFileSync(abs, 'utf8');
            if (disk !== c.content && entry.packVersion !== pack.version) {
              diffs[c.relPath] = unifiedSnippetDiff(c.relPath, disk, c.content);
            }
          }
        }
      } catch {
        // ignore synthesis errors in doctor
      }
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
    diffs,
  };
}

export function runVerifyGenerator(
  ctx: GeneratorContext,
  gen: PackDef['generators'][string]
): VerifyEntryResult[] {
  const expected = gen.expectedPaths(ctx);
  let generatedContents = new Map<string, string>();
  try {
    const plan = gen.plan(ctx);
    for (const c of plan.creates) {
      if (c.generated) {
        generatedContents.set(c.relPath, c.content);
      }
    }
  } catch {
    // ignore if plan needs extra flags
  }

  return expected.map((relPath) => {
    const absPath = path.join(ctx.cwd, relPath);
    if (!fs.existsSync(absPath)) {
      return { relPath, ok: false, reason: 'missing' };
    }
    const content = fs.readFileSync(absPath, 'utf8');
    if (content.trim().length === 0) {
      return { relPath, ok: false, reason: 'empty' };
    }
    const expectedGen = generatedContents.get(relPath);
    if (expectedGen !== undefined && content !== expectedGen) {
      return { relPath, ok: false, reason: 'drifted' };
    }
    return { relPath, ok: true };
  });
}
