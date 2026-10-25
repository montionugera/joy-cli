import * as fs from 'node:fs';
import * as path from 'node:path';
import { hasPackageDep } from '../../engine/config.js';
import {
  assertSafeRelativePath,
  isKebabRoute,
  isPascalCase,
  toKebab,
  toPascal,
} from '../../engine/names.js';
import {
  parseEvents,
  parseProps,
  parseSizes,
} from '../../engine/parse.js';
import {
  GeneratorContext,
  JoyError,
  PackDef,
  PlanResult,
  PropDef,
} from '../../engine/types.js';

function renderPropTsType(p: PropDef): string {
  if (p.type === 'enum' && p.enumValues) {
    return p.enumValues.map((v) => `'${v}'`).join(' | ');
  }
  if (p.type === 'array') return 'unknown[]';
  return p.type;
}

function renderPropDefault(p: PropDef): string {
  if (p.defaultValue === undefined) return '';
  if (p.type === 'string' || p.type === 'enum') {
    return ` = '${p.defaultValue}'`;
  }
  return ` = ${p.defaultValue}`;
}

function renderSveltePage(route: string, hasJoySvelte: boolean): string {
  const title = toPascal(route.replace(/\//g, '-'));
  const kebab = toKebab(title);
  if (hasJoySvelte) {
    return `<script lang="ts">
  import { Button, Badge } from '@montionugera/joy-svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<section class="joy-page-${kebab}">
  <header class="joy-page-header">
    <h1>{data.title ?? '${title}'}</h1>
    <Badge variant="brand">Active</Badge>
  </header>

  <div class="joy-page-body">
    <Button variant="solid">Get Started</Button>
  </div>
</section>

<style>
  .joy-page-${kebab} {
    display: flex;
    flex-direction: column;
    gap: var(--joy-space-4);
    padding: var(--joy-space-6);
    background: var(--joy-surface-base);
    color: var(--joy-text-primary);
  }

  .joy-page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--joy-space-3);
  }
</style>
`;
  }

  return `<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<section class="joy-page-${kebab}">
  <header class="joy-page-header">
    <h1>{data.title ?? '${title}'}</h1>
    <span class="joy-badge">Active</span>
  </header>

  <div class="joy-page-body">
    <button type="button" class="joy-btn">Get Started</button>
  </div>
</section>

<style>
  .joy-page-${kebab} {
    display: flex;
    flex-direction: column;
    gap: var(--joy-space-4);
    padding: var(--joy-space-6);
    background: var(--joy-surface-base);
    color: var(--joy-text-primary);
  }

  .joy-page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--joy-space-3);
  }
</style>
`;
}

function renderSveltePageServer(route: string): string {
  const title = toPascal(route.replace(/\//g, '-'));
  return `import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  return {
    title: '${title}',
    route: '/${route}',
  };
};
`;
}

function renderSveltePageTest(route: string, hasVitest: boolean): string {
  const title = toPascal(route.replace(/\//g, '-'));
  const runnerImport = hasVitest
    ? `import { describe, it, assert } from 'vitest';`
    : `import { describe, it } from 'node:test';\nimport * as assert from 'node:assert/strict';`;

  return `${runnerImport}
import { load } from './+page.server.js';

describe('/${route} +page.server load', () => {
  it('returns page metadata for ${title}', async () => {
    const result = await load({} as Parameters<typeof load>[0]);
    assert.deepEqual(result, {
      title: '${title}',
      route: '/${route}',
    });
  });
});
`;
}

function renderSvelteComponent(
  name: string,
  props: PropDef[],
  events: string[],
  sizes: string[]
): string {
  const kebab = toKebab(name);
  const sizeUnion = sizes.map((s) => `'${s}'`).join(' | ');
  const propInterfaceLines = [
    `    ref?: HTMLElement | null;`,
    `    size?: ${sizeUnion};`,
    `    children?: Snippet;`,
    ...props.map(
      (p) => `    ${p.name}${p.optional ? '?' : ''}: ${renderPropTsType(p)};`
    ),
    ...events.map((ev) => `    on${ev}?: (event: CustomEvent) => void;`),
  ];

  const destructureLines = [
    `    ref = $bindable(null),`,
    `    size = '${sizes[1] ?? sizes[0] ?? 'md'}',`,
    `    children,`,
    ...props.map((p) => `    ${p.name}${renderPropDefault(p)},`),
    ...events.map((ev) => `    on${ev},`),
  ];

  return `<script lang="ts">
  import type { Snippet } from 'svelte';

  export interface ${name}Props {
${propInterfaceLines.join('\n')}
  }

  let {
${destructureLines.join('\n')}
  }: ${name}Props = $props();
</script>

<div
  bind:this={ref}
  class="joy-${kebab}"
  data-size={size}
>
  {#if children}
    {@render children()}
  {/if}
</div>

<style>
  .joy-${kebab} {
    display: inline-flex;
    align-items: center;
    gap: var(--joy-space-2);
    padding: var(--joy-space-3);
    border-radius: var(--joy-radius-md);
    background: var(--joy-surface-elevated);
    color: var(--joy-text-primary);
  }
</style>
`;
}

function renderSvelteComponentTest(
  name: string,
  props: PropDef[],
  hasVitest: boolean
): string {
  const sampleProps = props
    .filter((p) => !p.optional)
    .map((p) => {
      if (p.type === 'number') return `${p.name}: 42`;
      if (p.type === 'boolean') return `${p.name}: true`;
      if (p.type === 'array') return `${p.name}: []`;
      if (p.type === 'enum' && p.enumValues?.[0]) return `${p.name}: '${p.enumValues[0]}'`;
      return `${p.name}: 'sample'`;
    })
    .join(', ');

  const runnerImport = hasVitest
    ? `import { describe, it, assert } from 'vitest';`
    : `import { describe, it } from 'node:test';\nimport * as assert from 'node:assert/strict';`;

  return `${runnerImport}
import type { ${name}Props } from './${name}.svelte';

describe('${name} component contract', () => {
  it('accepts valid ${name}Props', () => {
    const props: ${name}Props = { ${sampleProps} };
    assert.ok(props);
  });
});
`;
}

export const sveltekitPack: PackDef = {
  name: 'sveltekit',
  version: '0.1.0',
  compat: {
    '@sveltejs/kit': '^2.0.0',
    svelte: '^5.0.0',
  },
  generators: {
    page: {
      name: 'page',
      description: 'Scaffold a SvelteKit route (+page.svelte, +page.server.ts, page.test.ts)',
      expectedPaths(ctx: GeneratorContext): string[] {
        const route = ctx.target.replace(/^\/+|\/+$/g, '');
        if (!isKebabRoute(route)) {
          throw new JoyError(
            'E_USAGE',
            `Route "${ctx.target}" must be kebab-case (e.g. "pricing" or "account/billing")`,
            2
          );
        }
        const routesDir = ctx.config.paths.routes ?? 'src/routes';
        return [
          `${routesDir}/${route}/+page.svelte`,
          `${routesDir}/${route}/+page.server.ts`,
          `${routesDir}/${route}/page.test.ts`,
        ];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const route = ctx.target.replace(/^\/+|\/+$/g, '');
        const [pagePath, serverPath, testPath] = this.expectedPaths(ctx);
        const hasJoySvelte = hasPackageDep(ctx.cwd, '@montionugera/joy-svelte');
        const hasVitest = hasPackageDep(ctx.cwd, 'vitest');
        return {
          creates: [
            { relPath: pagePath, content: renderSveltePage(route, hasJoySvelte) },
            { relPath: serverPath, content: renderSveltePageServer(route) },
            { relPath: testPath, content: renderSveltePageTest(route, hasVitest), isTest: true },
          ],
          edits: [],
          testFiles: [testPath],
        };
      },
    },
    component: {
      name: 'component',
      description: 'Scaffold a Svelte 5 runes component (<Name>.svelte + <Name>.test.ts)',
      expectedPaths(ctx: GeneratorContext): string[] {
        if (!isPascalCase(ctx.target)) {
          throw new JoyError(
            'E_USAGE',
            `Component name "${ctx.target}" must be PascalCase (e.g. "PriceCard")`,
            2
          );
        }
        const componentsDir = ctx.config.paths.components ?? 'src/lib/components';
        return [
          `${componentsDir}/${ctx.target}.svelte`,
          `${componentsDir}/${ctx.target}.test.ts`,
        ];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const [compPath, testPath] = this.expectedPaths(ctx);
        const props = parseProps(ctx.args.props);
        const events = parseEvents(ctx.args.events);
        const sizes = parseSizes(ctx.args.sizes);
        const hasVitest = hasPackageDep(ctx.cwd, 'vitest');
        return {
          creates: [
            {
              relPath: compPath,
              content: renderSvelteComponent(ctx.target, props, events, sizes),
            },
            {
              relPath: testPath,
              content: renderSvelteComponentTest(ctx.target, props, hasVitest),
              isTest: true,
            },
          ],
          edits: [],
          testFiles: [testPath],
        };
      },
    },
    test: {
      name: 'test',
      description: 'Scaffold a sibling .test.ts file for an existing source file',
      expectedPaths(ctx: GeneratorContext): string[] {
        const rel = ctx.target;
        const ext = path.extname(rel);
        const stem = ext ? rel.slice(0, -ext.length) : rel;
        // SvelteKit reserves + prefix in src/routes; strip leading + for test file
        const dir = path.posix.dirname(stem);
        const base = path.posix.basename(stem).replace(/^\+/, '');
        return [dir === '.' ? `${base}.test.ts` : `${dir}/${base}.test.ts`];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const absTarget = assertSafeRelativePath(ctx.cwd, ctx.target);
        if (!fs.existsSync(absTarget)) {
          throw new JoyError(
            'E_TARGET_MISSING',
            `Target file "${ctx.target}" does not exist on disk.`,
            1
          );
        }
        const [testPath] = this.expectedPaths(ctx);
        const baseName = path.basename(ctx.target, path.extname(ctx.target));
        const hasVitest = hasPackageDep(ctx.cwd, 'vitest');
        const runnerImport = hasVitest
          ? `import { describe, it, assert } from 'vitest';`
          : `import { describe, it } from 'node:test';\nimport * as assert from 'node:assert/strict';`;
        const content = `${runnerImport}

describe('${baseName}', () => {
  it('loads target module test harness', () => {
    assert.ok(true);
  });
});
`;
        return {
          creates: [{ relPath: testPath, content, isTest: true }],
          edits: [],
          testFiles: [testPath],
        };
      },
    },
  },
};
