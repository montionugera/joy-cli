# `@montionugera/joy-cli` (`joy`)

Unified scaffolding CLI for Joymify TypeScript/Node (`pnpm`) projects (`sveltekit`, `nest`, and `joy-design-internal` stacks).

## Features

- **Zero external template dependencies:** Deterministic TypeScript generators with atomic in-memory planning (`plan` -> `apply` -> `verify` -> `rollback`).
- **`joy new <project-name> [--template sveltekit|nest]`:** Scaffolds a brand-new SvelteKit or NestJS project directory and automatically initializes `.npmrc`, anchors, and `joy.config.json`.
- **`joy init`:** Auto-detects `sveltekit`, `nest`, or `joy-design-internal` stack, detects `AppModule` across `src/app.module.ts`, `src/modules/main/app.module.ts` (`content-svc`, `message-svc`), `src/modules/app/app.module.ts`, and `user-api/src/app.module.ts` (`user-svc`), configures `.npmrc` for `@montionugera:registry=https://npm.pkg.github.com`, installs `// joy:anchor` markers idempotently, and writes `joy.config.json`.
- **`joy doctor` & `joy verify`:** Verifies `.npmrc`, installed `@montionugera/*` semver ranges against pack `compat`, anchor presence, and `.joy/lock.json` template version drift (with template diffs).
- **Track S1 (`sveltekit` pack):**
  - `joy g page <route>`: Scaffolds `+page.svelte` (Svelte 5 `$props()`, `--joy-*` semantic CSS tokens, auto-detected `@montionugera/joy-svelte` primitives), `+page.server.ts`, and `+page.test.ts` (Vitest).
  - `joy g component <Name> [--props …] [--events …] [--sizes …]`: Scaffolds `<Name>.svelte` (Svelte 5 runes `$props()`, `$bindable(null)`) and `<Name>.test.ts`.
  - `joy g test <target-file>`: Scaffolds sibling `<stem>.test.ts` (Vitest) or exits `1` (`E_TARGET_MISSING`).
- **Track S2 (`nest` pack — EntitySpec-first):**
  - `joy g entity-spec <Name> --fields …`: Scaffolds `@Restful({ path: '<plural-kebab>' })` class using `@id()`, `@str()`, `@int()`, `@float()`, `@bool()`, `@datetime()`, `@enumOf([...])` from `@montionugera/entity-spec`.
  - `joy g dto <Name> [--check] [--regen]`: Scaffolds `@generated` `dto/<kebab>.dto.ts` calling `entitySpec(<Name>Spec)` + `createSchema`, `updateSchema`, `readSchema` from `@montionugera/entity-spec-gen-zod` and `openapiComponents`, `openapiPaths` from `@montionugera/entity-spec-gen-openapi`. Overwrites `@generated` files by default; `--check` exits `2` (`E_DRIFT`) on byte drift.
  - `joy g entity <Name> [--fields …] [--orm=typeorm|prisma]`: Scaffolds TypeORM `@Entity` with typed `@Column()` properties mapped from `--fields` / `<kebab>.entity-spec.ts`.
  - `joy g repo <Name>`: Scaffolds TypeORM `@InjectRepository(<Name>Entity)` repository wrapper + `.spec.ts`.
  - `joy g service <Name>`: Scaffolds NestJS `@Injectable()` service validating DTOs via Zod schemas + `.spec.ts`.
  - `joy g controller <Name>`: Scaffolds NestJS CRUD controller + `.spec.ts`.
  - `joy g module <Name>`: Scaffolds NestJS module and registers it at `// joy:anchor app-module-imports` and `// joy:anchor app-module-declarations`.
  - `joy g resource <Name> --fields …`: Runs `entity-spec` + `dto` + `entity` + `repo` + `service` + `controller` + `module` atomically in one transaction.
  - `joy g test <target-file>`: Scaffolds sibling `<stem>.spec.ts` (Jest) or exits `1` (`E_TARGET_MISSING`).
- **Track S3 (`joy-design-internal` pack — Manifest-driven cross-framework component twins):**
  - `joy g component <Name> [--props …] [--events …] [--sizes …]`: Scaffolds `manifests/<kebab>.json`, `packages/contracts/schemas/<kebab>.contract.json`, `packages/svelte/src/lib/<Name>.svelte`, `packages/react/src/<Name>.tsx`, `packages/svelte/test/<kebab>.generated.test.js`, `packages/react/test/<kebab>.generated.test.js`, and inserts anchor-based exports/CSS/parity entries into `packages/svelte/src/lib/index.ts`, `packages/react/src/index.ts`, `packages/tokens/build.js` (`/* joy:anchor component-styles-end */`), and `scripts/parity-check.mjs`.
  - `joy verify [component] <Name>`: Verifies all generated artifacts, anchor registrations, and reports `PENDING flutter`.

## Exit Codes

| Exit Code | Error Codes | Meaning |
|---|---|---|
| `0` | — | Success (or `--check` with zero drift) |
| `1` | `E_VERIFY_FAILED`, `E_TARGET_MISSING`, `E_ANCHOR_MISSING`, `E_DOCTOR_FAILED` | Runtime/verification failure, missing target file, or missing anchor (all writes rolled back) |
| `2` | `E_USAGE`, `E_EXISTS`, `E_DRIFT` | Invalid CLI usage/field grammar, existing user-owned file without `--force`, or `@generated` file drift under `--check` |
