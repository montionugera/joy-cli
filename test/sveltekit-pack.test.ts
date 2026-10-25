import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { runCli } from '../src/cli.js';

describe('Track S1: sveltekit pack (page, component, test)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joy-cli-s1-'));
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'fixture-sveltekit',
          devDependencies: {
            '@sveltejs/kit': '^2.50.0',
            svelte: '^5.54.0',
            '@montionugera/joy-svelte': '^0.1.0',
            vitest: '^3.0.0',
          },
          scripts: {
            check: 'node -e "process.exit(0)"',
            'test:unit': 'node -e "process.exit(0)"',
          },
        },
        null,
        2
      )
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes sveltekit stack and scaffolds page, component, and sibling test', async () => {
    expect(await runCli(['init'], tmpDir)).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, 'joy.config.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.npmrc'))).toBe(true);

    // 1. joy g page pricing --no-verify
    expect(await runCli(['g', 'page', 'pricing', '--no-verify'], tmpDir)).toBe(0);
    const pageSvelte = fs.readFileSync(
      path.join(tmpDir, 'src/routes/pricing/+page.svelte'),
      'utf8'
    );
    expect(pageSvelte).toContain('@montionugera/joy-svelte');
    expect(pageSvelte).toContain('$props()');
    expect(pageSvelte).toContain('var(--joy-');
    expect(pageSvelte).not.toContain('export let');
    expect(fs.existsSync(path.join(tmpDir, 'src/routes/pricing/+page.server.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'src/routes/pricing/page.test.ts'))).toBe(true);

    // Verify joy verify page pricing
    expect(await runCli(['verify', 'page', 'pricing'], tmpDir)).toBe(0);

    // 2. joy g component PriceCard --props amount:number,currency:string=USD --events select --no-verify
    expect(
      await runCli(
        [
          'g',
          'component',
          'PriceCard',
          '--props',
          'amount:number,currency:string=USD',
          '--events',
          'select',
          '--no-verify',
        ],
        tmpDir
      )
    ).toBe(0);
    const compSvelte = fs.readFileSync(
      path.join(tmpDir, 'src/lib/components/PriceCard.svelte'),
      'utf8'
    );
    expect(compSvelte).toContain('amount: number;');
    expect(compSvelte).toContain("currency = 'USD'");
    expect(compSvelte).toContain('$bindable(null)');
    expect(compSvelte).toContain('onselect?:');
    expect(fs.existsSync(path.join(tmpDir, 'src/lib/components/PriceCard.test.ts'))).toBe(true);

    // 3. joy g test on missing file -> exit 1 (E_TARGET_MISSING)
    expect(await runCli(['g', 'test', 'src/lib/missing.ts', '--no-verify'], tmpDir)).toBe(1);

    // 4. joy g test on existing file -> creates sibling .test.ts (Vitest)
    fs.mkdirSync(path.join(tmpDir, 'src/lib/utils'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src/lib/utils/format.ts'),
      'export const fmt = (n: number) => String(n);\n'
    );
    expect(await runCli(['g', 'test', 'src/lib/utils/format.ts', '--no-verify'], tmpDir)).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, 'src/lib/utils/format.test.ts'))).toBe(true);
  });

  it('runs non-destructive --dry-run smoke check against real joymify-portal repo', async () => {
    const portalDir = '/Users/pasitnusso/workspace/repos/joymify-portal';
    if (!fs.existsSync(portalDir)) return;
    const beforeStatus = execSync('git status --porcelain', { cwd: portalDir, encoding: 'utf8' });
    expect(await runCli(['init', '--dry-run'], portalDir)).toBe(0);
    expect(await runCli(['g', 'page', 'pricing', '--dry-run'], portalDir)).toBe(0);
    expect(await runCli(['g', 'component', 'PricingHero', '--dry-run'], portalDir)).toBe(0);
    const afterStatus = execSync('git status --porcelain', { cwd: portalDir, encoding: 'utf8' });
    expect(afterStatus).toBe(beforeStatus);
  });
});

describe('Fixture: fixtures/sveltekit', () => {
  it('copies fixtures/sveltekit, runs init + page + component + verify + doctor', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'joy-cli-fix-s1-'));
    try {
      fs.cpSync(path.resolve(import.meta.dirname, '../fixtures/sveltekit'), tmp, {
        recursive: true,
      });
      expect(await runCli(['init'], tmp)).toBe(0);
      expect(await runCli(['g', 'page', 'pricing'], tmp)).toBe(0);
      expect(
        await runCli(
          ['g', 'component', 'PriceCard', '--props', 'amount:number,currency:string=USD'],
          tmp
        )
      ).toBe(0);
      expect(await runCli(['verify', 'page', 'pricing'], tmp)).toBe(0);
      expect(await runCli(['verify', 'component', 'PriceCard'], tmp)).toBe(0);
      expect(await runCli(['doctor', '--strict'], tmp)).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
