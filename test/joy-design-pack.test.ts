import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

describe('S3 joy-design-internal pack & S4 joy new', () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  function createJoyDesignFixture(): string {
    const root = makeTmpDir('joy-design-fixture-');
    const write = (rel: string, content: string) => {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    };
    write(
      'package.json',
      JSON.stringify({ name: 'joy-design', private: true, scripts: { check: 'echo ok' } }, null, 2)
    );
    write('packages/svelte/src/lib/index.ts', "export { default as Alert } from './Alert.svelte';\n");
    write('packages/react/src/index.ts', "export { Alert, type AlertProps } from './Alert.js';\n");
    write(
      'scripts/parity-check.mjs',
      [
        'export const COMPONENTS = [',
        "  'Alert'",
        '];',
        'export const REF_FORWARDING = [',
        "  'Alert'",
        '];',
        'export const SVELTE_REF_REST = [',
        "  'Alert'",
        '];',
        'export const CONTRACT = {',
        '  Alert: [',
        "    'children'",
        '  ]',
        '};',
        '',
      ].join('\n')
    );
    write(
      'packages/tokens/build.js',
      'const componentStyles = `\n.joy-alert { display: block; }\n`;\nconst other = `x`;\n'
    );
    return root;
  }

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('auto-detects joy-design-internal stack on joy init and installs all 6 anchors idempotently', async () => {
    const root = createJoyDesignFixture();
    expect(await runCli(['init'], root)).toBe(0);

    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'joy.config.json'), 'utf8'));
    expect(cfg.packs).toEqual(['joy-design-internal']);

    expect(fs.readFileSync(path.join(root, 'packages/svelte/src/lib/index.ts'), 'utf8')).toContain(
      '// joy:anchor exports'
    );
    expect(fs.readFileSync(path.join(root, 'packages/react/src/index.ts'), 'utf8')).toContain(
      '// joy:anchor exports'
    );
    const parity = fs.readFileSync(path.join(root, 'scripts/parity-check.mjs'), 'utf8');
    expect(parity).toContain('// joy:anchor components');
    expect(parity).toContain('// joy:anchor ref-forwarding');
    expect(parity).toContain('// joy:anchor svelte-ref-rest');
    expect(parity).toContain('// joy:anchor contract');
    expect(fs.readFileSync(path.join(root, 'packages/tokens/build.js'), 'utf8')).toContain(
      '/* joy:anchor component-styles-end */'
    );
  });

  it('scaffolds multi-framework component (manifest, Svelte 5, React forwardRef, contract, CSS tokens, parity entries, tests) and verifies twin parity', async () => {
    const root = createJoyDesignFixture();
    expect(await runCli(['init'], root)).toBe(0);

    const code = await runCli(
      [
        'g',
        'component',
        'DemoBox',
        '--props',
        'value:string,disabled:boolean=false,tone:enum(a|b)=a',
        '--events',
        'change',
        '--sizes',
        'sm,md,lg',
        '--no-verify',
      ],
      root
    );
    expect(code).toBe(0);

    // 1. Manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifests/demo-box.json'), 'utf8'));
    expect(manifest.component).toBe('DemoBox');
    expect(manifest.targets.flutter).toBe('none');
    expect(manifest.events.change).toEqual({
      react: 'onChange',
      svelte: 'onchange',
      flutter: 'onChanged',
    });

    // 2. Svelte 5 twin
    const svelteCode = fs.readFileSync(
      path.join(root, 'packages/svelte/src/lib/DemoBox.svelte'),
      'utf8'
    );
    expect(svelteCode).toContain('ref = $bindable(null)');
    expect(svelteCode).toContain('bind:this={ref}');
    expect(svelteCode).toContain('{...rest}');
    expect(svelteCode).toContain('joy-demo-box');

    // 3. React twin
    const reactCode = fs.readFileSync(path.join(root, 'packages/react/src/DemoBox.tsx'), 'utf8');
    expect(reactCode).toContain('React.forwardRef');
    expect(reactCode).toContain("DemoBox.displayName = 'DemoBox'");
    expect(reactCode).toContain('onChange');

    // 4. CSS tokens (no raw hex/rgb/hsl, has 44px coarse pointer & reduced motion)
    const buildJs = fs.readFileSync(path.join(root, 'packages/tokens/build.js'), 'utf8');
    expect(buildJs).toContain('.joy-demo-box');
    expect(buildJs).toContain('prefers-reduced-motion: reduce');
    expect(buildJs).toContain('pointer: coarse');
    expect(buildJs).toContain('44px');
    expect(buildJs).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);

    // 5. Parity-check registrations
    const parity = fs.readFileSync(path.join(root, 'scripts/parity-check.mjs'), 'utf8');
    expect(parity).toContain("'Alert',\n  'DemoBox'");
    expect(parity).toContain('DemoBox: [');

    // 6. joy verify DemoBox passes
    expect(await runCli(['verify', 'component', 'DemoBox'], root)).toBe(0);
    expect(await runCli(['verify', 'DemoBox'], root)).toBe(0);

    // 7. Deleting a prop from Svelte twin causes joy verify DemoBox to fail (exit 1)
    fs.writeFileSync(
      path.join(root, 'packages/svelte/src/lib/DemoBox.svelte'),
      svelteCode.replace(/value\?: string;\n/, ''),
      'utf8'
    );
    expect(await runCli(['verify', 'DemoBox'], root)).toBe(1);
  });

  it('scaffolds new SvelteKit and NestJS projects via joy new <name> --template <sveltekit|nest>', async () => {
    const parent = makeTmpDir('joy-new-');

    expect(await runCli(['new', 'my-portal', '--template', 'sveltekit'], parent)).toBe(0);
    const portalDir = path.join(parent, 'my-portal');
    expect(fs.existsSync(path.join(portalDir, 'joy.config.json'))).toBe(true);
    expect(fs.existsSync(path.join(portalDir, '.npmrc'))).toBe(true);
    expect(fs.existsSync(path.join(portalDir, 'src/routes/+page.svelte'))).toBe(true);
    expect(await runCli(['g', 'page', 'dashboard', '--no-verify'], portalDir)).toBe(0);
    expect(fs.existsSync(path.join(portalDir, 'src/routes/dashboard/+page.svelte'))).toBe(true);

    expect(await runCli(['new', 'billing-svc', '--template', 'nest'], parent)).toBe(0);
    const svcDir = path.join(parent, 'billing-svc');
    expect(fs.existsSync(path.join(svcDir, 'joy.config.json'))).toBe(true);
    expect(fs.existsSync(path.join(svcDir, 'src/modules/main/app.module.ts'))).toBe(true);
    expect(
      await runCli(
        ['g', 'resource', 'Subscription', '--fields', 'plan:str,price:float', '--no-verify'],
        svcDir
      )
    ).toBe(0);
    expect(
      fs.existsSync(path.join(svcDir, 'src/modules/subscription/subscription.controller.ts'))
    ).toBe(true);
  });
});
