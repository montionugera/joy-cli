import { appendLockEntry, hasPackageDep, loadJoyConfig } from './engine/config.js';
import { runDoctor, runVerifyGenerator } from './engine/doctor.js';
import { runInit } from './engine/init.js';
import { runNewProject } from './engine/new-project.js';
import { parseCliArgs } from './engine/parse.js';
import { ExitCode, JoyError, PackDef } from './engine/types.js';
import { applyPlan } from './engine/writer.js';
import { joyDesignInternalPack, verifyJoyDesignComponent } from './packs/joy-design-internal/index.js';
import { nestPack } from './packs/nest/index.js';
import { sveltekitPack } from './packs/sveltekit/index.js';

export const BUILTIN_PACKS: Record<string, PackDef> = {
  sveltekit: sveltekitPack,
  nest: nestPack,
  'joy-design-internal': joyDesignInternalPack,
};

function printHelp(): void {
  console.log(`@montionugera/joy-cli (v0.1.0) — Joymify project scaffolding CLI

Usage:
  joy new <project-name> [--template sveltekit|nest] [--dry-run] [--force]
  joy init [--dry-run] [--install-deps]
  joy doctor [--strict] [--json]
  joy verify [generator] <Name>
  joy g <generator> <Name> [options]

SvelteKit Pack Generators:
  page <route>                       Scaffold +page.svelte, +page.server.ts, +page.test.ts
  component <Name> [--props ...]     Scaffold Svelte 5 runes component + Vitest test
  test <target-file>                 Scaffold sibling .test.ts (Vitest)

NestJS Pack Generators:
  entity-spec <Name> --fields ...    Scaffold @Restful EntitySpec class
  dto <Name> [--check] [--regen]     Scaffold/verify @generated Zod + OpenAPI DTO barrel
  entity <Name> [--orm=typeorm|prisma] Scaffold TypeORM @Entity with typed @Column fields
  repo <Name>                        Scaffold TypeORM Repository wrapper + .spec.ts
  service <Name>                     Scaffold NestJS Service + .spec.ts
  controller <Name>                  Scaffold NestJS CRUD Controller + .spec.ts
  module <Name>                      Scaffold NestJS Module & register in AppModule
  resource <Name> --fields ...       Scaffold full EntitySpec-first resource in one command
  test <target-file>                 Scaffold sibling .spec.ts (Jest)

Flags:
  --fields <name:type[=default],...> Field specs (str, email, uuid, uri, int, float, bool, datetime, enum(a|b))
  --props <name:type[=default],...>  Component prop specs (string, number, boolean, array, enum(a|b))
  --events <ev1,ev2>                 Component events
  --sizes <sm,md,lg>                 Component sizes
  --orm <typeorm|prisma>             ORM target for entity generator (default: typeorm)
  --dry-run                          Preview planned file changes without writing to disk
  --force                            Overwrite existing user-owned files
  --check                            Verify @generated files have zero drift (exit 2 on drift)
  --no-verify                        Skip running post-generation verification commands
  --keep-on-fail                     Keep generated files if verification fails
  --json                             Output machine-readable JSON summary
`);
}

function resolveGenerator(
  packNames: ('sveltekit' | 'nest' | 'joy-design-internal')[],
  generatorName: string
): { pack: PackDef; gen: PackDef['generators'][string] } {
  for (const packName of packNames) {
    const pack = BUILTIN_PACKS[packName];
    if (pack && pack.generators[generatorName]) {
      return { pack, gen: pack.generators[generatorName] };
    }
  }
  for (const pack of Object.values(BUILTIN_PACKS)) {
    if (pack.generators[generatorName]) {
      return { pack, gen: pack.generators[generatorName] };
    }
  }
  throw new JoyError(
    'E_USAGE',
    `Unknown generator "${generatorName}". Run "joy --help" for available generators.`,
    2
  );
}

export async function runCli(
  argv: string[],
  cwd: string = process.cwd()
): Promise<ExitCode> {
  try {
    const args = parseCliArgs(argv);

    if (args.command === 'help') {
      printHelp();
      return 0;
    }

    if (args.command === 'new') {
      const res = runNewProject(cwd, args.target!, {
        template: args.template ?? 'sveltekit',
        dryRun: args.dryRun,
        force: args.force,
      });
      if (args.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          `[joy new] Created ${res.template} project "${res.projectName}" at ${res.targetDir} (${res.files.length} files)`
        );
      }
      return 0;
    }

    if (args.command === 'init') {
      const res = runInit(cwd, {
        dryRun: args.dryRun,
        installDeps: args.installDeps,
      });
      if (args.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          `[joy init] stack=${res.stack} (${args.dryRun ? 'dry-run' : 'applied'}): ${
            res.touchedFiles.length > 0 ? res.touchedFiles.join(', ') : 'already up to date'
          }`
        );
      }
      return 0;
    }

    if (args.command === 'doctor') {
      const res = runDoctor(cwd, BUILTIN_PACKS, { strict: args.strict });
      if (args.json) {
        console.log(JSON.stringify(res, null, 2));
      } else if (res.ok) {
        console.log('[joy doctor] OK — all checks passed.');
      } else {
        for (const w of res.warnings) {
          console.warn(`WARN: ${w}`);
        }
        for (const diff of Object.values(res.diffs)) {
          console.log(diff);
        }
      }
      return 0;
    }

    const config = loadJoyConfig(cwd);
    const { pack, gen } = resolveGenerator(config.packs, args.generator!);
    const ctx = {
      cwd,
      target: args.target!,
      args,
      config,
    };

    if (args.command === 'verify') {
      const results =
        pack.name === 'joy-design-internal' && gen.name === 'component'
          ? verifyJoyDesignComponent(cwd, args.target!)
          : runVerifyGenerator(ctx, gen);
      if (pack.name === 'joy-design-internal' && gen.name === 'component') {
        console.log('PENDING flutter');
      }
      let anyFail = false;
      for (const r of results) {
        if (r.ok) {
          console.log(`PASS ${r.relPath}`);
        } else {
          anyFail = true;
          console.error(`FAIL ${r.relPath} (${r.reason})`);
        }
      }
      return anyFail ? 1 : 0;
    }

    // command === 'generate'
    const plan = gen.plan(ctx);
    const verifyCommands = [...config.verify];
    if (plan.testFiles && plan.testFiles.length > 0) {
      if (pack.name === 'sveltekit' && hasPackageDep(cwd, 'vitest')) {
        verifyCommands.push(`pnpm exec vitest run ${plan.testFiles.map((f) => JSON.stringify(f)).join(' ')}`);
      } else if (pack.name === 'nest' && hasPackageDep(cwd, 'jest')) {
        verifyCommands.push(`pnpm exec jest ${plan.testFiles.map((f) => JSON.stringify(f)).join(' ')}`);
      }
    }

    const summary = applyPlan(cwd, plan, {
      dryRun: args.dryRun,
      force: args.force,
      check: args.check,
      keepOnFail: args.keepOnFail,
      noVerify: args.noVerify,
      verifyCommands,
    });

    if (!args.dryRun && !args.check) {
      appendLockEntry(cwd, {
        generator: gen.name,
        pack: pack.name,
        packVersion: pack.version,
        target: args.target!,
        ...(args.fields ? { fields: args.fields } : {}),
        ...(args.props ? { props: args.props } : {}),
        ...(args.events ? { events: args.events } : {}),
        ...(args.sizes ? { sizes: args.sizes } : {}),
        files: [...summary.created, ...summary.overwritten],
        at: new Date().toISOString(),
      });
    }

    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else if (args.check) {
      console.log(`[joy check] OK — ${args.generator} ${args.target} has zero drift.`);
    } else {
      for (const f of summary.created) console.log(`CREATE ${f}`);
      for (const f of summary.overwritten) console.log(`OVERWRITE ${f}`);
      for (const f of summary.edited) console.log(`EDIT ${f}`);
      if (args.dryRun) {
        for (const d of Object.values(summary.diffs)) {
          if (d) console.log(d);
        }
      }
    }

    return 0;
  } catch (err: unknown) {
    if (err instanceof JoyError) {
      console.error(err.message);
      return err.exitCode;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
