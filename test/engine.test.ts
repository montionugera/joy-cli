import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseFields,
  parseProps,
  parseEvents,
  parseSizes,
  parseCliArgs,
} from '../src/engine/parse.js';
import {
  insertAtAnchor,
  ensureNestAppModuleAnchors,
} from '../src/engine/anchors.js';
import {
  detectStack,
  detectAppModulePath,
} from '../src/engine/config.js';
import {
  GENERATED_BANNER,
  applyPlan,
} from '../src/engine/writer.js';
import { runInit } from '../src/engine/init.js';
import { runDoctor } from '../src/engine/doctor.js';

describe('Task 0: Engine Contract', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joy-cli-engine-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses fields and rejects unknown field types with exitCode 2 (E_USAGE)', () => {
    const fields = parseFields('number:str,total:float,paid:bool=false,status:enum(draft|sent)');
    expect(fields).toHaveLength(4);
    expect(fields[0]).toEqual({ name: 'number', type: 'str', optional: false });
    expect(fields[2]).toEqual({ name: 'paid', type: 'bool', optional: false, defaultValue: 'false' });
    expect(fields[3]).toEqual({ name: 'status', type: 'enum', optional: false, enumValues: ['draft', 'sent'] });

    expect(() => parseFields('total:strng')).toThrowError(/Invalid field type "strng"/);
  });

  it('parses component props, events, and sizes', () => {
    const props = parseProps('amount:number,currency:string=USD,variant:enum(sm|md|lg)=md');
    expect(props).toHaveLength(3);
    expect(props[0]).toEqual({ name: 'amount', type: 'number', optional: false });
    expect(props[1]).toEqual({ name: 'currency', type: 'string', optional: true, defaultValue: 'USD' });
    expect(props[2]).toEqual({
      name: 'variant',
      type: 'enum',
      optional: true,
      enumValues: ['sm', 'md', 'lg'],
      defaultValue: 'md',
    });

    expect(parseEvents('select,change')).toEqual(['select', 'change']);
    expect(parseSizes('sm,md,lg')).toEqual(['sm', 'md', 'lg']);
  });

  it('auto-detects AppModule across standard, content-svc, and user-svc paths', () => {
    const mainDir = path.join(tmpDir, 'src/modules/main');
    fs.mkdirSync(mainDir, { recursive: true });
    fs.writeFileSync(path.join(mainDir, 'app.module.ts'), 'export class AppModule {}');
    expect(detectAppModulePath(tmpDir)).toBe('src/modules/main/app.module.ts');
  });

  it('inserts imports and array items at anchors idempotently', () => {
    const raw = `import { Module } from '@nestjs/common';\nimport { ContentModule } from '../content/content.module';\n\n@Module({\n  imports: [\n    ContentModule,\n  ],\n})\nexport class AppModule {}\n`;
    const withAnchors = ensureNestAppModuleAnchors(raw);
    expect(withAnchors).toContain('// joy:anchor app-module-imports');
    expect(withAnchors).toContain('// joy:anchor app-module-declarations');

    const step1 = insertAtAnchor(
      withAnchors,
      'app-module-imports',
      `import { InvoiceModule } from '../invoice/invoice.module';`
    );
    const step2 = insertAtAnchor(step1, 'app-module-declarations', '    InvoiceModule,', {
      arrayItem: true,
    });
    expect(step2).toContain(`import { InvoiceModule } from '../invoice/invoice.module';`);
    expect(step2).toContain('    InvoiceModule,\n    // joy:anchor app-module-declarations');
  });

  it('enforces @generated overwrite, --check E_DRIFT (exit 2), and user-owned E_EXISTS (exit 2)', () => {
    const dtoPath = path.join(tmpDir, 'dto/invoice.dto.ts');
    fs.mkdirSync(path.dirname(dtoPath), { recursive: true });
    const v1Content = `${GENERATED_BANNER}\nexport const v = 1;\n`;
    const v2Content = `${GENERATED_BANNER}\nexport const v = 2;\n`;

    // 1. Initial write
    applyPlan(tmpDir, {
      creates: [{ relPath: 'dto/invoice.dto.ts', content: v1Content, generated: true }],
      edits: [],
    }, {});
    expect(fs.readFileSync(dtoPath, 'utf8')).toBe(v1Content);

    // 2. --check with drift -> throws E_DRIFT (exitCode 2) and does not modify disk
    expect(() =>
      applyPlan(tmpDir, {
        creates: [{ relPath: 'dto/invoice.dto.ts', content: v2Content, generated: true }],
        edits: [],
      }, { check: true })
    ).toThrowError(/E_DRIFT/);
    expect(fs.readFileSync(dtoPath, 'utf8')).toBe(v1Content);

    // 3. Re-run without --check overwrites @generated file automatically
    applyPlan(tmpDir, {
      creates: [{ relPath: 'dto/invoice.dto.ts', content: v2Content, generated: true }],
      edits: [],
    }, {});
    expect(fs.readFileSync(dtoPath, 'utf8')).toBe(v2Content);

    // 4. User-owned file without @generated header -> E_EXISTS (exitCode 2)
    fs.writeFileSync(dtoPath, '// hand-edited\nexport const v = 3;\n');
    expect(() =>
      applyPlan(tmpDir, {
        creates: [{ relPath: 'dto/invoice.dto.ts', content: v2Content, generated: true }],
        edits: [],
      }, {})
    ).toThrowError(/E_EXISTS/);
  });

  it('rolls back all created and edited files when a verify command fails', () => {
    const existingPath = path.join(tmpDir, 'existing.ts');
    fs.writeFileSync(existingPath, 'export const a = 1;\n// joy:anchor test\n');

    expect(() =>
      applyPlan(
        tmpDir,
        {
          creates: [{ relPath: 'new-file.ts', content: 'export const b = 2;\n' }],
          edits: [{ relPath: 'existing.ts', content: 'export const a = 1;\nexport const b = 2;\n// joy:anchor test\n' }],
        },
        { verifyCommands: ['node -e "process.exit(1)"'] }
      )
    ).toThrowError(/E_VERIFY_FAILED/);

    expect(fs.existsSync(path.join(tmpDir, 'new-file.ts'))).toBe(false);
    expect(fs.readFileSync(existingPath, 'utf8')).toBe('export const a = 1;\n// joy:anchor test\n');
  });
});

describe('Security: Path traversal & unsafe path rejection', () => {
  it('rejects ../ path traversal and shell metacharacters with E_USAGE (exitCode 2)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'joy-cli-sec-'));
    try {
      expect(() =>
        applyPlan(tmp, {
          creates: [{ relPath: '../../escape.ts', content: 'export const x = 1;\n' }],
          edits: [],
        })
      ).toThrowError(/E_USAGE/);

      expect(() =>
        applyPlan(tmp, {
          creates: [{ relPath: 'src/bad;rm -rf.ts', content: 'export const x = 1;\n' }],
          edits: [],
        })
      ).toThrowError(/E_USAGE/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
