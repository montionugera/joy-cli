import * as fs from 'node:fs';
import * as path from 'node:path';
import { insertAtAnchor, hasAnchor } from '../../engine/anchors.js';
import { toKebab, toPascal } from '../../engine/names.js';
import { parseEvents, parseProps, parseSizes } from '../../engine/parse.js';
import {
  GeneratorContext,
  JoyError,
  PackDef,
  PlanResult,
  PropDef,
} from '../../engine/types.js';

const FILES = {
  svelteIndex: 'packages/svelte/src/lib/index.ts',
  reactIndex: 'packages/react/src/index.ts',
  parity: 'scripts/parity-check.mjs',
  css: 'packages/tokens/build.js',
};

export function installJoyDesignAnchors(cwd: string, dryRun = false): string[] {
  const touched: string[] = [];

  for (const rel of [FILES.svelteIndex, FILES.reactIndex]) {
    const abs = path.join(cwd, rel);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    if (!hasAnchor(raw, 'exports')) {
      touched.push(rel);
      if (!dryRun) {
        const next = `${raw.trimEnd()}\n// joy:anchor exports\n`;
        fs.writeFileSync(abs, next, 'utf8');
      }
    }
  }

  const parityAbs = path.join(cwd, FILES.parity);
  if (fs.existsSync(parityAbs)) {
    let raw = fs.readFileSync(parityAbs, 'utf8');
    const orig = raw;
    const declMap: Array<[string, string, string]> = [
      ['export const COMPONENTS = [', '];', 'components'],
      ['export const REF_FORWARDING = [', '];', 'ref-forwarding'],
      ['export const SVELTE_REF_REST = [', '];', 'svelte-ref-rest'],
      ['export const CONTRACT = {', '};', 'contract'],
    ];
    for (const [startToken, endToken, anchorName] of declMap) {
      if (hasAnchor(raw, anchorName)) continue;
      const startIdx = raw.indexOf(startToken);
      if (startIdx === -1) continue;
      const closeIdx = raw.indexOf(endToken, startIdx);
      if (closeIdx === -1) continue;
      raw = `${raw.slice(0, closeIdx)}  // joy:anchor ${anchorName}\n${raw.slice(closeIdx)}`;
    }
    if (raw !== orig) {
      touched.push(FILES.parity);
      if (!dryRun) {
        fs.writeFileSync(parityAbs, raw, 'utf8');
      }
    }
  }

  const cssAbs = path.join(cwd, FILES.css);
  if (fs.existsSync(cssAbs)) {
    const raw = fs.readFileSync(cssAbs, 'utf8');
    if (!hasAnchor(raw, 'component-styles-end')) {
      const marker = 'const componentStyles = `';
      const startIdx = raw.indexOf(marker);
      if (startIdx !== -1) {
        const closeBacktick = raw.indexOf('`;', startIdx + marker.length);
        if (closeBacktick !== -1) {
          touched.push(FILES.css);
          if (!dryRun) {
            const before = raw.slice(0, closeBacktick).trimEnd();
            const after = raw.slice(closeBacktick);
            const next = `${before}\n/* joy:anchor component-styles-end */\n${after}`;
            fs.writeFileSync(cssAbs, next, 'utf8');
          }
        }
      }
    }
  }

  return touched;
}

function renderManifest(
  pascal: string,
  kebab: string,
  props: PropDef[],
  events: string[]
): string {
  const propsObj: Record<string, unknown> = {};
  for (const p of props) {
    const entry: Record<string, unknown> = {
      type: p.type,
      required: !p.optional && p.defaultValue === undefined,
    };
    if (p.enumValues) entry.values = p.enumValues;
    if (p.defaultValue !== undefined) {
      entry.default =
        p.type === 'boolean'
          ? p.defaultValue === 'true'
          : p.type === 'number'
            ? Number(p.defaultValue)
            : p.defaultValue;
    }
    propsObj[p.name] = entry;
  }

  const eventsObj: Record<string, unknown> = {};
  for (const ev of events) {
    const evPascal = toPascal(ev);
    eventsObj[ev] = {
      react: `on${evPascal}`,
      svelte: `on${ev.toLowerCase()}`,
      flutter: ev === 'change' ? 'onChanged' : `on${evPascal}`,
    };
  }

  const manifest = {
    $schema: './manifest-schema-v1.json',
    component: pascal,
    targets: {
      react: `packages/react/src/${pascal}.tsx`,
      svelte: `packages/svelte/src/lib/${pascal}.svelte`,
      flutter: 'none',
    },
    props: propsObj,
    events: eventsObj,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function tsTypeForProp(p: PropDef): string {
  if (p.type === 'enum' && p.enumValues) {
    return p.enumValues.map((v) => `'${v}'`).join(' | ');
  }
  if (p.type === 'array') return 'unknown[]';
  return p.type;
}

function defaultLiteral(p: PropDef): string {
  if (p.defaultValue === undefined) {
    if (p.type === 'boolean') return 'false';
    if (p.type === 'number') return '0';
    if (p.type === 'array') return '[]';
    if (p.type === 'enum' && p.enumValues?.length) return `'${p.enumValues[0]}'`;
    return "''";
  }
  if (p.type === 'boolean' || p.type === 'number') return p.defaultValue;
  return `'${p.defaultValue}'`;
}

function renderSvelteTwin(
  pascal: string,
  kebab: string,
  props: PropDef[],
  events: string[],
  sizes: string[]
): string {
  const hasDisabled = props.some((p) => p.name === 'disabled');
  const propTypeLines = [
    ...props.map((p) => `    ${p.name}?: ${tsTypeForProp(p)};`),
    ...events.map((e) => `    on${e.toLowerCase()}?: (event: CustomEvent) => void;`),
    `    children?: Snippet;`,
    `    class?: string;`,
    `    ref?: HTMLDivElement | null;`,
    `    [key: string]: unknown;`,
  ].join('\n');

  const propDestructure = [
    ...props.map((p) => `    ${p.name} = ${defaultLiteral(p)},`),
    ...events.map((e) => `    on${e.toLowerCase()},`),
    `    children,`,
    `    class: className = '',`,
    `    ref = $bindable(null),`,
    `    ...rest`,
  ].join('\n');

  const sizeClassExprs = sizes
    .filter((s) => s !== 'md')
    .map((s) => `size === '${s}' && 'joy-${kebab}--${s}'`);
  const disabledClassExpr = hasDisabled ? [`disabled && 'joy-${kebab}--disabled'`] : [];
  const classParts = [`'joy-${kebab}'`, ...sizeClassExprs, ...disabledClassExpr, 'className'].join(
    ', '
  );
  const ariaAttr = hasDisabled ? `\n  aria-disabled={disabled || undefined}` : '';

  return `<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
${propTypeLines}
  }

  let {
${propDestructure}
  }: Props = $props();

  const classes = $derived([${classParts}].filter(Boolean).join(' '));
</script>

<div
  bind:this={ref}
  class={classes}${ariaAttr}
  {...rest}
>
  {#if children}
    {@render children()}
  {/if}
</div>
`;
}

function renderReactTwin(
  pascal: string,
  kebab: string,
  props: PropDef[],
  events: string[],
  sizes: string[]
): string {
  const hasDisabled = props.some((p) => p.name === 'disabled');
  const ifaceLines = [
    ...props.map((p) => `  ${p.name}?: ${tsTypeForProp(p)};`),
    ...events.map((e) => `  on${toPascal(e)}?: (event: unknown) => void;`),
    `  children?: React.ReactNode;`,
    `  className?: string;`,
  ].join('\n');

  const destructure = [
    ...props.map((p) => `      ${p.name} = ${defaultLiteral(p)},`),
    ...events.map((e) => `      on${toPascal(e)},`),
    `      children,`,
    `      className = '',`,
    `      ...rest`,
  ].join('\n');

  const sizeClassExprs = sizes
    .filter((s) => s !== 'md')
    .map((s) => `size === '${s}' && 'joy-${kebab}--${s}'`);
  const disabledClassExpr = hasDisabled ? [`disabled && 'joy-${kebab}--disabled'`] : [];
  const cxParts = [`'joy-${kebab}'`, ...sizeClassExprs, ...disabledClassExpr, 'className'].join(
    ',\n          '
  );
  const ariaAttr = hasDisabled ? `\n        aria-disabled={disabled || undefined}` : '';

  return `import * as React from 'react';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export interface ${pascal}Props extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
${ifaceLines}
}

export const ${pascal} = React.forwardRef<HTMLDivElement, ${pascal}Props>(
  (
    {
${destructure}
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cx(
          ${cxParts}
        )}${ariaAttr}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

${pascal}.displayName = '${pascal}';
`;
}

function renderContract(pascal: string, kebab: string, props: PropDef[], events: string[]): string {
  const defaults: Record<string, unknown> = {};
  for (const p of props) {
    if (p.defaultValue !== undefined) {
      defaults[p.name] =
        p.type === 'boolean'
          ? p.defaultValue === 'true'
          : p.type === 'number'
            ? Number(p.defaultValue)
            : p.defaultValue;
    }
  }
  const snake = kebab.replace(/-/g, '_');
  const touch = { minTouchTarget: { width: 44.0, height: 44.0 } };
  const scenarios =
    events.length > 0
      ? [
          {
            id: `${snake}_${events[0]}`,
            description: `Default ${pascal} emits ${events[0]} on tap and satisfies touch target`,
            props: defaults,
            actions: [{ type: 'tap' }],
            expect: { events: { [events[0]]: 1 }, ...touch },
          },
        ]
      : [
          {
            id: `${snake}_default`,
            description: `Default ${pascal} satisfies touch target`,
            props: defaults,
            actions: [{ type: 'tap' }],
            expect: { ...touch },
          },
        ];

  return `${JSON.stringify(
    {
      $schema: './contract-schema-v2.json',
      component: `Joy${pascal}`,
      version: '2.0.0',
      scenarios,
    },
    null,
    2
  )}\n`;
}

function renderCssBlock(pascal: string, kebab: string, props: PropDef[], sizes: string[]): string {
  const cls = `.joy-${kebab}`;
  const hasDisabled = props.some((p) => p.name === 'disabled');
  const sizeRules = sizes
    .filter((s) => s !== 'md')
    .map((s) => `${cls}--${s} {\n  min-height: var(--joy-control-height-${s});\n}`);
  const disabledRules = hasDisabled
    ? [
        `${cls}--disabled {\n  color: var(--joy-text-disabled);\n  cursor: not-allowed;\n  opacity: 0.5;\n}`,
      ]
    : [];

  return [
    `/* ${pascal} */`,
    `${cls} {
  display: block;
  box-sizing: border-box;
  min-height: var(--joy-control-height-md);
  padding: var(--joy-space-2) var(--joy-space-4);
  background: var(--joy-surface-card);
  color: var(--joy-text-primary);
  border: 1px solid var(--joy-border-default);
  border-radius: var(--joy-radius-control);
  font-family: var(--joy-font-family-sans);
  font-size: var(--joy-font-size-md);
  transition: background-color var(--joy-duration-fast) var(--joy-ease-out);
}`,
    `${cls}:hover {\n  background: var(--joy-surface-sunken);\n}`,
    `${cls}:focus-visible {\n  outline: var(--joy-focus-ring);\n  outline-offset: 2px;\n}`,
    `${cls}:active {\n  border-color: var(--joy-accent-default);\n}`,
    ...sizeRules,
    ...disabledRules,
    `@media (pointer: coarse) {\n  ${cls} {\n    min-height: 44px;\n  }\n}`,
    `@media (prefers-reduced-motion: reduce) {\n  ${cls} {\n    transition: none;\n  }\n}`,
  ].join('\n');
}

function renderTwinTests(pascal: string, kebab: string, events: string[]): { svelte: string; react: string } {
  const head =
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport path from 'node:path';\n\n";
  const svelteEv = events
    .map((e) => `  assert.ok(src.includes('on${e.toLowerCase()}'), '${pascal} must declare on${e.toLowerCase()}');`)
    .join('\n');
  const reactEv = events
    .map((e) => `  assert.ok(src.includes('on${toPascal(e)}'), '${pascal} must declare on${toPascal(e)}');`)
    .join('\n');

  return {
    svelte: `${head}const src = fs.readFileSync(new URL('../src/lib/${pascal}.svelte', import.meta.url), 'utf8');\n\ntest('${pascal}: root class, ref and rest wiring', () => {\n  assert.ok(src.includes('joy-${kebab}'), '${pascal} must have the joy-${kebab} class');\n  assert.ok(src.includes('bind:this={ref}'), '${pascal} must expose its root through ref');\n  assert.ok(src.includes('{...rest}'), '${pascal} must spread rest props');\n${svelteEv}\n});\n`,
    react: `${head}const src = fs.readFileSync(new URL('../src/${pascal}.tsx', import.meta.url), 'utf8');\n\ntest('${pascal}: root class, ref forwarding and rest wiring', () => {\n  assert.ok(src.includes('joy-${kebab}'), '${pascal} must have the joy-${kebab} class');\n  assert.ok(src.includes('React.forwardRef'), '${pascal} must forward its ref');\n  assert.ok(src.includes('{...rest}'), '${pascal} must spread rest props');\n${reactEv}\n});\n`,
  };
}

export function verifyJoyDesignComponent(
  cwd: string,
  target: string
): Array<{ relPath: string; ok: boolean; reason?: string }> {
  const pascal = toPascal(target);
  const kebab = toKebab(pascal);
  const results: Array<{ relPath: string; ok: boolean; reason?: string }> = [];

  const requiredFiles = [
    `manifests/${kebab}.json`,
    `packages/svelte/src/lib/${pascal}.svelte`,
    `packages/react/src/${pascal}.tsx`,
    `packages/contracts/schemas/${kebab}.contract.json`,
    `packages/svelte/test/${kebab}.generated.test.js`,
    `packages/react/test/${kebab}.generated.test.js`,
  ];

  for (const relPath of requiredFiles) {
    const abs = path.join(cwd, relPath);
    if (!fs.existsSync(abs)) {
      results.push({ relPath, ok: false, reason: 'missing file' });
    } else {
      results.push({ relPath, ok: true });
    }
  }

  const manifestAbs = path.join(cwd, `manifests/${kebab}.json`);
  const svelteAbs = path.join(cwd, `packages/svelte/src/lib/${pascal}.svelte`);
  const reactAbs = path.join(cwd, `packages/react/src/${pascal}.tsx`);
  if (fs.existsSync(manifestAbs) && fs.existsSync(svelteAbs) && fs.existsSync(reactAbs)) {
    const manifest = JSON.parse(fs.readFileSync(manifestAbs, 'utf8'));
    const svelteSrc = fs.readFileSync(svelteAbs, 'utf8');
    const reactSrc = fs.readFileSync(reactAbs, 'utf8');
    const propNames = Object.keys(manifest.props ?? {});
    for (const p of propNames) {
      if (!new RegExp(`\\b${p}\\??\\s*:`).test(svelteSrc)) {
        results.push({ relPath: `props:${p} (svelte)`, ok: false, reason: `missing prop ${p} in Svelte twin` });
      }
      if (!new RegExp(`\\b${p}\\??\\s*:`).test(reactSrc)) {
        results.push({ relPath: `props:${p} (react)`, ok: false, reason: `missing prop ${p} in React twin` });
      }
    }
  }

  return results;
}

function planJoyDesignComponent(ctx: GeneratorContext): PlanResult {
  const pascal = toPascal(ctx.target);
  if (pascal !== ctx.target || !/^[A-Z][A-Za-z0-9]*$/.test(ctx.target)) {
    throw new JoyError(
      'E_USAGE',
      `Component name "${ctx.target}" must be PascalCase (e.g. DemoBox)`,
      2
    );
  }
  const kebab = toKebab(pascal);
  const props = parseProps(ctx.args.props);
  const events = parseEvents(ctx.args.events);
  const sizes = ctx.args.sizes ? parseSizes(ctx.args.sizes) : [];

  if (sizes.length > 0 && !props.some((p) => p.name === 'size')) {
    props.push({
      name: 'size',
      type: 'enum',
      optional: true,
      defaultValue: sizes.includes('md') ? 'md' : sizes[0],
      enumValues: sizes,
    });
  }

  const twinTests = renderTwinTests(pascal, kebab, events);
  const creates = [
    { relPath: `manifests/${kebab}.json`, content: renderManifest(pascal, kebab, props, events) },
    {
      relPath: `packages/svelte/src/lib/${pascal}.svelte`,
      content: renderSvelteTwin(pascal, kebab, props, events, sizes),
    },
    {
      relPath: `packages/react/src/${pascal}.tsx`,
      content: renderReactTwin(pascal, kebab, props, events, sizes),
    },
    {
      relPath: `packages/contracts/schemas/${kebab}.contract.json`,
      content: renderContract(pascal, kebab, props, events),
    },
    {
      relPath: `packages/svelte/test/${kebab}.generated.test.js`,
      content: twinTests.svelte,
      isTest: true,
    },
    {
      relPath: `packages/react/test/${kebab}.generated.test.js`,
      content: twinTests.react,
      isTest: true,
    },
  ];

  const edits: Array<{ relPath: string; content: string }> = [];

  const svelteIndexAbs = path.join(ctx.cwd, FILES.svelteIndex);
  if (!fs.existsSync(svelteIndexAbs)) {
    throw new JoyError('E_TARGET_MISSING', `Missing ${FILES.svelteIndex}`, 1);
  }
  edits.push({
    relPath: FILES.svelteIndex,
    content: insertAtAnchor(
      fs.readFileSync(svelteIndexAbs, 'utf8'),
      'exports',
      `export { default as ${pascal} } from './${pascal}.svelte';`
    ),
  });

  const reactIndexAbs = path.join(ctx.cwd, FILES.reactIndex);
  if (!fs.existsSync(reactIndexAbs)) {
    throw new JoyError('E_TARGET_MISSING', `Missing ${FILES.reactIndex}`, 1);
  }
  edits.push({
    relPath: FILES.reactIndex,
    content: insertAtAnchor(
      fs.readFileSync(reactIndexAbs, 'utf8'),
      'exports',
      `export { ${pascal}, type ${pascal}Props } from './${pascal}.js';`
    ),
  });

  const parityAbs = path.join(ctx.cwd, FILES.parity);
  if (!fs.existsSync(parityAbs)) {
    throw new JoyError('E_TARGET_MISSING', `Missing ${FILES.parity}`, 1);
  }
  let paritySrc = fs.readFileSync(parityAbs, 'utf8');
  for (const anchor of ['components', 'ref-forwarding', 'svelte-ref-rest']) {
    paritySrc = insertAtAnchor(paritySrc, anchor, `  '${pascal}'`, { arrayItem: true });
  }
  const contractProps = [
    ...props.map((p) => p.name),
    ...events.map((e) => `on${toPascal(e)}`),
    'children',
  ];
  const contractBlock = `  ${pascal}: [\n${contractProps
    .map((n, idx) => `    '${n}'${idx < contractProps.length - 1 ? ',' : ''}`)
    .join('\n')}\n  ]`;
  paritySrc = insertAtAnchor(paritySrc, 'contract', contractBlock, { arrayItem: true });
  edits.push({ relPath: FILES.parity, content: paritySrc });

  const cssAbs = path.join(ctx.cwd, FILES.css);
  if (!fs.existsSync(cssAbs)) {
    throw new JoyError('E_TARGET_MISSING', `Missing ${FILES.css}`, 1);
  }
  edits.push({
    relPath: FILES.css,
    content: insertAtAnchor(
      fs.readFileSync(cssAbs, 'utf8'),
      'component-styles-end',
      renderCssBlock(pascal, kebab, props, sizes)
    ),
  });

  return {
    creates,
    edits,
    testFiles: [
      `packages/svelte/test/${kebab}.generated.test.js`,
      `packages/react/test/${kebab}.generated.test.js`,
    ],
  };
}

export const joyDesignInternalPack: PackDef = {
  name: 'joy-design-internal',
  version: '0.1.0',
  compat: {},
  generators: {
    component: {
      name: 'component',
      description:
        'Scaffold manifest-driven Svelte 5 + React 19 component twins, contract, CSS tokens, and parity entries',
      plan: planJoyDesignComponent,
      expectedPaths: (ctx) => {
        const pascal = toPascal(ctx.target);
        const kebab = toKebab(ctx.target);
        return [
          `manifests/${kebab}.json`,
          `packages/contracts/schemas/${kebab}.contract.json`,
          `packages/svelte/src/lib/${pascal}.svelte`,
          `packages/react/src/${pascal}.tsx`,
          `packages/svelte/test/${kebab}.generated.test.js`,
          `packages/react/test/${kebab}.generated.test.js`,
        ];
      },
    },
  },
};
