import * as fs from 'node:fs';
import * as path from 'node:path';
import { insertAtAnchor } from '../../engine/anchors.js';
import { readLock } from '../../engine/config.js';
import {
  assertSafeRelativePath,
  isPascalCase,
  toCamel,
  toKebab,
  toPascal,
  toPluralKebab,
  toPluralSnake,
  toSnake,
} from '../../engine/names.js';
import {
  extractFieldsFromEntitySpecSource,
  parseFields,
} from '../../engine/parse.js';
import {
  FieldDef,
  GeneratorContext,
  JoyError,
  PackDef,
  PlanResult,
} from '../../engine/types.js';
import { GENERATED_BANNER } from '../../engine/writer.js';

function resolveFieldsForTarget(
  ctx: GeneratorContext,
  moduleDir: string,
  kebab: string
): FieldDef[] {
  if (ctx.args.fields) {
    return parseFields(ctx.args.fields);
  }
  const specFile = path.join(ctx.cwd, `${moduleDir}/${kebab}.entity-spec.ts`);
  if (fs.existsSync(specFile)) {
    const parsed = extractFieldsFromEntitySpecSource(
      fs.readFileSync(specFile, 'utf8')
    );
    if (parsed.length > 0) return parsed;
  }
  const lock = readLock(ctx.cwd);
  const lockEntry = lock.entries.find(
    (e) =>
      e.target === ctx.target &&
      e.fields &&
      (e.generator === 'resource' || e.generator === 'entity-spec')
  );
  if (lockEntry?.fields) {
    return parseFields(lockEntry.fields);
  }
  return [
    { name: 'name', type: 'str', optional: false },
  ];
}

function fieldTsType(f: FieldDef): string {
  if (f.type === 'int' || f.type === 'float') return 'number';
  if (f.type === 'bool') return 'boolean';
  if (f.type === 'enum' && f.enumValues) {
    return f.enumValues.map((v) => `'${v}'`).join(' | ');
  }
  return 'string';
}

function fieldDecoratorCall(f: FieldDef): string {
  const opts = f.optional ? '{ optional: true }' : '';
  if (f.type === 'enum' && f.enumValues) {
    const vals = f.enumValues.map((v) => `'${v}'`).join(', ');
    return `enumOf([${vals}]${opts ? `, ${opts}` : ''})`;
  }
  return `${f.type}(${opts})`;
}

function renderEntitySpec(name: string, fields: FieldDef[]): string {
  const pluralKebab = toPluralKebab(name);
  const usedBuilders = new Set<string>(['id']);
  for (const f of fields) {
    if (f.type === 'enum') usedBuilders.add('enumOf');
    else usedBuilders.add(f.type);
  }
  const builderImports = [...usedBuilders].sort().join(', ');

  const fieldLines = [
    `  @id()`,
    `  id!: string;`,
    ...fields.flatMap((f) => [
      ``,
      `  @${fieldDecoratorCall(f)}`,
      `  ${f.name}${f.optional ? '?' : '!'}: ${fieldTsType(f)};`,
    ]),
  ];

  return `import { Restful, entitySpec, ${builderImports} } from '@montionugera/entity-spec';

@Restful({ path: '${pluralKebab}' })
export class ${name}Spec {
${fieldLines.join('\n')}
}

export const ${name}EntitySpec = entitySpec(${name}Spec);
`;
}

function renderDtoBarrel(name: string, kebab: string): string {
  return `${GENERATED_BANNER}
import { z } from 'zod';
import {
  createSchema,
  updateSchema,
  readSchema,
} from '@montionugera/entity-spec-gen-zod';
import {
  openapiComponents,
  openapiPaths,
} from '@montionugera/entity-spec-gen-openapi';
import { ${name}EntitySpec } from '../${kebab}.entity-spec';

export const Create${name}Schema = createSchema(${name}EntitySpec);
export const Update${name}Schema = updateSchema(${name}EntitySpec);
export const Read${name}Schema = readSchema(${name}EntitySpec);

export type Create${name}Dto = z.infer<typeof Create${name}Schema>;
export type Update${name}Dto = z.infer<typeof Update${name}Schema>;
export type Read${name}Dto = z.infer<typeof Read${name}Schema>;

export const ${name}OpenApi = {
  components: openapiComponents(${name}EntitySpec),
  paths: openapiPaths(${name}EntitySpec),
};
`;
}

function renderDtoSpec(name: string, kebab: string, fields: FieldDef[]): string {
  const samplePayload = fields
    .filter((f) => !f.optional)
    .map((f) => {
      if (f.type === 'int') return `      ${f.name}: 1,`;
      if (f.type === 'float') return `      ${f.name}: 19.99,`;
      if (f.type === 'bool') return `      ${f.name}: ${f.defaultValue ?? 'true'},`;
      if (f.type === 'email') return `      ${f.name}: 'user@example.com',`;
      if (f.type === 'uuid') return `      ${f.name}: '550e8400-e29b-41d4-a716-446655440000',`;
      if (f.type === 'uri') return `      ${f.name}: 'https://example.com',`;
      if (f.type === 'datetime') return `      ${f.name}: '2026-10-25T00:00:00Z',`;
      if (f.type === 'enum' && f.enumValues?.[0]) return `      ${f.name}: '${f.enumValues[0]}',`;
      return `      ${f.name}: 'sample-${f.name}',`;
    })
    .join('\n');

  return `import {
  Create${name}Schema,
  Update${name}Schema,
  ${name}OpenApi,
} from './${kebab}.dto';

describe('${name} DTO & OpenAPI schemas', () => {
  it('validates create payload and generates OpenAPI paths', () => {
    const parsed = Create${name}Schema.safeParse({
${samplePayload}
    });
    expect(parsed.success).toBe(true);
    expect(Update${name}Schema.safeParse({}).success).toBe(true);
    expect(${name}OpenApi.paths).toBeDefined();
  });
});
`;
}

function renderTypeOrmColumn(f: FieldDef): string {
  const colOpts: string[] = [];
  if (f.type === 'int') {
    colOpts.push(`type: 'int'`);
  } else if (f.type === 'float') {
    colOpts.push(`type: 'double precision'`);
  } else if (f.type === 'bool') {
    colOpts.push(`type: 'boolean'`);
  } else if (f.type === 'datetime') {
    colOpts.push(`type: 'timestamptz'`);
  } else {
    colOpts.push(`type: 'varchar'`);
  }

  if (f.optional) {
    colOpts.push(`nullable: true`);
  }
  if (f.defaultValue !== undefined) {
    if (f.type === 'bool' || f.type === 'int' || f.type === 'float') {
      colOpts.push(`default: ${f.defaultValue}`);
    } else {
      colOpts.push(`default: '${f.defaultValue}'`);
    }
  }
  if (f.name !== toSnake(f.name)) {
    colOpts.push(`name: '${toSnake(f.name)}'`);
  }

  return `  @Column({ ${colOpts.join(', ')} })\n  ${f.name}${f.optional ? '?' : '!'}: ${fieldTsType(f)};`;
}

function renderTypeOrmEntity(name: string, fields: FieldDef[]): string {
  const tableName = toPluralSnake(name);
  const columns = fields.map(renderTypeOrmColumn).join('\n\n');
  return `import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('${tableName}')
export class ${name}Entity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

${columns}

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
`;
}

function renderPrismaFragment(name: string, fields: FieldDef[]): string {
  const lines = fields.map((f) => {
    let pType = 'String';
    if (f.type === 'int') pType = 'Int';
    else if (f.type === 'float') pType = 'Float';
    else if (f.type === 'bool') pType = 'Boolean';
    else if (f.type === 'datetime') pType = 'DateTime';
    return `  ${f.name} ${pType}${f.optional ? '?' : ''}`;
  });
  return `model ${name} {
  id        String   @id @default(uuid())
${lines.join('\n')}
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`;
}

function renderRepository(name: string, kebab: string): string {
  return `import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ${name}Entity } from './${kebab}.entity';
import type { Create${name}Dto, Update${name}Dto } from './dto/${kebab}.dto';

@Injectable()
export class ${name}Repository {
  constructor(
    @InjectRepository(${name}Entity)
    private readonly repo: Repository<${name}Entity>
  ) {}

  async findAll(limit = 20, offset = 0): Promise<${name}Entity[]> {
    return this.repo.find({ take: limit, skip: offset });
  }

  async findOne(id: string): Promise<${name}Entity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async create(payload: Create${name}Dto): Promise<${name}Entity> {
    const entity = this.repo.create(payload as Partial<${name}Entity>);
    return this.repo.save(entity);
  }

  async update(id: string, payload: Update${name}Dto): Promise<${name}Entity | null> {
    await this.repo.update(id, payload as Partial<${name}Entity>);
    return this.findOne(id);
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.repo.delete(id);
    return Boolean(res.affected && res.affected > 0);
  }
}
`;
}

function renderRepositorySpec(name: string, kebab: string): string {
  return `import { ${name}Repository } from './${kebab}.repository';

describe('${name}Repository', () => {
  it('delegates findAll and findOne to TypeORM Repository', async () => {
    const mockRepo = {
      find: async () => [{ id: '1' }],
      findOne: async () => ({ id: '1' }),
    };
    const repo = new ${name}Repository(mockRepo as never);
    await expect(repo.findAll()).resolves.toEqual([{ id: '1' }]);
    await expect(repo.findOne('1')).resolves.toEqual({ id: '1' });
  });
});
`;
}

function renderService(name: string, kebab: string): string {
  const camel = toCamel(name);
  return `import { Injectable, NotFoundException } from '@nestjs/common';
import { ${name}Repository } from './${kebab}.repository';
import {
  Create${name}Schema,
  Update${name}Schema,
  type Create${name}Dto,
  type Update${name}Dto,
} from './dto/${kebab}.dto';
import type { ${name}Entity } from './${kebab}.entity';

@Injectable()
export class ${name}Service {
  constructor(private readonly ${camel}Repo: ${name}Repository) {}

  async findAll(limit = 20, offset = 0): Promise<${name}Entity[]> {
    return this.${camel}Repo.findAll(limit, offset);
  }

  async findOne(id: string): Promise<${name}Entity> {
    const found = await this.${camel}Repo.findOne(id);
    if (!found) {
      throw new NotFoundException(\`${name} \${id} not found\`);
    }
    return found;
  }

  async create(input: Create${name}Dto): Promise<${name}Entity> {
    const valid = Create${name}Schema.parse(input);
    return this.${camel}Repo.create(valid);
  }

  async update(id: string, input: Update${name}Dto): Promise<${name}Entity> {
    const valid = Update${name}Schema.parse(input);
    const updated = await this.${camel}Repo.update(id, valid);
    if (!updated) {
      throw new NotFoundException(\`${name} \${id} not found\`);
    }
    return updated;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.${camel}Repo.remove(id);
    return { deleted };
  }
}
`;
}

function renderServiceSpec(name: string, kebab: string): string {
  return `import { ${name}Service } from './${kebab}.service';

describe('${name}Service', () => {
  it('delegates findAll to ${name}Repository', async () => {
    const mockRepo = {
      findAll: async () => [{ id: '1' }],
      findOne: async () => ({ id: '1' }),
    };
    const service = new ${name}Service(mockRepo as never);
    await expect(service.findAll()).resolves.toEqual([{ id: '1' }]);
  });
});
`;
}

function renderController(name: string, kebab: string): string {
  const pluralKebab = toPluralKebab(name);
  const camel = toCamel(name);
  return `import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ${name}Service } from './${kebab}.service';
import type { Create${name}Dto, Update${name}Dto } from './dto/${kebab}.dto';

@Controller('${pluralKebab}')
export class ${name}Controller {
  constructor(private readonly ${camel}Service: ${name}Service) {}

  @Get()
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.${camel}Service.findAll(
      limit ? Number(limit) : 20,
      offset ? Number(offset) : 0
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.${camel}Service.findOne(id);
  }

  @Post()
  async create(@Body() body: Create${name}Dto) {
    return this.${camel}Service.create(body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Update${name}Dto) {
    return this.${camel}Service.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.${camel}Service.remove(id);
  }
}
`;
}

function renderControllerSpec(name: string, kebab: string): string {
  return `import { ${name}Controller } from './${kebab}.controller';

describe('${name}Controller', () => {
  it('delegates findAll to ${name}Service', async () => {
    const mockService = {
      findAll: async () => [{ id: '1' }],
    };
    const controller = new ${name}Controller(mockService as never);
    await expect(controller.findAll()).resolves.toEqual([{ id: '1' }]);
  });
});
`;
}

function renderModule(name: string, kebab: string): string {
  return `import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ${name}Entity } from './${kebab}.entity';
import { ${name}Repository } from './${kebab}.repository';
import { ${name}Service } from './${kebab}.service';
import { ${name}Controller } from './${kebab}.controller';

@Module({
  imports: [TypeOrmModule.forFeature([${name}Entity])],
  controllers: [${name}Controller],
  providers: [${name}Repository, ${name}Service],
  exports: [${name}Service, ${name}Repository],
})
export class ${name}Module {}
`;
}

function buildAppModuleEdit(
  ctx: GeneratorContext,
  name: string,
  kebab: string,
  moduleRelPath: string
): { relPath: string; content: string } | null {
  const appModuleRel =
    ctx.config.anchors['app-module-imports'] ?? 'src/app.module.ts';
  const appModuleAbs = path.join(ctx.cwd, appModuleRel);
  if (!fs.existsSync(appModuleAbs)) {
    return null;
  }
  const raw = fs.readFileSync(appModuleAbs, 'utf8');
  const appModuleDir = path.posix.dirname(appModuleRel);
  let relImport = path.posix.relative(
    appModuleDir,
    moduleRelPath.replace(/\.ts$/, '')
  );
  if (!relImport.startsWith('.')) {
    relImport = `./${relImport}`;
  }

  const withImport = insertAtAnchor(
    raw,
    'app-module-imports',
    `import { ${name}Module } from '${relImport}';`
  );
  const withDecl = insertAtAnchor(
    withImport,
    'app-module-declarations',
    `    ${name}Module,`,
    { arrayItem: true }
  );
  return { relPath: appModuleRel, content: withDecl };
}

function assertPascalTarget(target: string): string {
  const pascal = toPascal(target);
  if (!isPascalCase(target)) {
    throw new JoyError(
      'E_USAGE',
      `Entity/Resource name "${target}" must be PascalCase (e.g. "${pascal}")`,
      2
    );
  }
  return target;
}

export const nestPack: PackDef = {
  name: 'nest',
  version: '0.1.0',
  compat: {
    '@montionugera/entity-spec': '^2.0.0',
    '@montionugera/entity-spec-gen-zod': '^2.0.0',
    '@montionugera/entity-spec-gen-openapi': '^2.0.0',
    '@montionugera/server-decorator': '^2.0.0',
  },
  generators: {
    'entity-spec': {
      name: 'entity-spec',
      description: 'Scaffold a canonical @Restful EntitySpec class (<kebab>.entity-spec.ts)',
      expectedPaths(ctx: GeneratorContext): string[] {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        return [`${modulesDir}/${kebab}/${kebab}.entity-spec.ts`];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const name = assertPascalTarget(ctx.target);
        const [specPath] = this.expectedPaths(ctx);
        const fields = parseFields(
          ctx.args.fields ?? 'name:str'
        );
        return {
          creates: [{ relPath: specPath, content: renderEntitySpec(name, fields) }],
          edits: [],
        };
      },
    },
    dto: {
      name: 'dto',
      description: 'Scaffold/regenerate @generated Zod + OpenAPI DTO barrel from EntitySpec',
      expectedPaths(ctx: GeneratorContext): string[] {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        if (ctx.args.check) {
          return [`${modulesDir}/${kebab}/dto/${kebab}.dto.ts`];
        }
        return [
          `${modulesDir}/${kebab}/dto/${kebab}.dto.ts`,
          `${modulesDir}/${kebab}/dto/${kebab}.dto.spec.ts`,
        ];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        const moduleDir = `${modulesDir}/${kebab}`;
        const fields = resolveFieldsForTarget(ctx, moduleDir, kebab);
        const dtoPath = `${moduleDir}/dto/${kebab}.dto.ts`;
        const dtoSpecPath = `${moduleDir}/dto/${kebab}.dto.spec.ts`;

        if (ctx.args.check) {
          return {
            creates: [
              {
                relPath: dtoPath,
                content: renderDtoBarrel(name, kebab),
                generated: true,
              },
            ],
            edits: [],
          };
        }

        const creates = [
          {
            relPath: dtoPath,
            content: renderDtoBarrel(name, kebab),
            generated: true,
          },
        ];
        if (!fs.existsSync(path.join(ctx.cwd, dtoSpecPath)) || ctx.args.force) {
          creates.push({
            relPath: dtoSpecPath,
            content: renderDtoSpec(name, kebab, fields),
            generated: false,
          });
        }

        return {
          creates,
          edits: [],
          testFiles: [dtoSpecPath],
        };
      },
    },
    entity: {
      name: 'entity',
      description: 'Scaffold a TypeORM @Entity class (or Prisma model with --orm=prisma)',
      expectedPaths(ctx: GeneratorContext): string[] {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        const base = [`${modulesDir}/${kebab}/${kebab}.entity.ts`];
        if (ctx.args.orm === 'prisma') {
          base.push(`prisma/${kebab}.prisma`);
        }
        return base;
      },
      plan(ctx: GeneratorContext): PlanResult {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        const moduleDir = `${modulesDir}/${kebab}`;
        const fields = resolveFieldsForTarget(ctx, moduleDir, kebab);
        const paths = this.expectedPaths(ctx);
        const creates = [
          {
            relPath: paths[0],
            content: renderTypeOrmEntity(name, fields),
          },
        ];
        if (ctx.args.orm === 'prisma' && paths[1]) {
          creates.push({
            relPath: paths[1],
            content: renderPrismaFragment(name, fields),
          });
        }
        return { creates, edits: [] };
      },
    },
    repo: {
      name: 'repo',
      description: 'Scaffold a TypeORM Repository wrapper and unit spec',
      expectedPaths(ctx: GeneratorContext): string[] {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        return [
          `${modulesDir}/${kebab}/${kebab}.repository.ts`,
          `${modulesDir}/${kebab}/${kebab}.repository.spec.ts`,
        ];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const [repoPath, specPath] = this.expectedPaths(ctx);
        return {
          creates: [
            { relPath: repoPath, content: renderRepository(name, kebab) },
            { relPath: specPath, content: renderRepositorySpec(name, kebab), isTest: true },
          ],
          edits: [],
          testFiles: [specPath],
        };
      },
    },
    service: {
      name: 'service',
      description: 'Scaffold a NestJS @Injectable Service and unit spec',
      expectedPaths(ctx: GeneratorContext): string[] {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        return [
          `${modulesDir}/${kebab}/${kebab}.service.ts`,
          `${modulesDir}/${kebab}/${kebab}.service.spec.ts`,
        ];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const [svcPath, specPath] = this.expectedPaths(ctx);
        return {
          creates: [
            { relPath: svcPath, content: renderService(name, kebab) },
            { relPath: specPath, content: renderServiceSpec(name, kebab), isTest: true },
          ],
          edits: [],
          testFiles: [specPath],
        };
      },
    },
    controller: {
      name: 'controller',
      description: 'Scaffold a NestJS CRUD Controller and unit spec',
      expectedPaths(ctx: GeneratorContext): string[] {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        return [
          `${modulesDir}/${kebab}/${kebab}.controller.ts`,
          `${modulesDir}/${kebab}/${kebab}.controller.spec.ts`,
        ];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const [ctrlPath, specPath] = this.expectedPaths(ctx);
        return {
          creates: [
            { relPath: ctrlPath, content: renderController(name, kebab) },
            { relPath: specPath, content: renderControllerSpec(name, kebab), isTest: true },
          ],
          edits: [],
          testFiles: [specPath],
        };
      },
    },
    module: {
      name: 'module',
      description: 'Scaffold a NestJS Module and register it in AppModule',
      expectedPaths(ctx: GeneratorContext): string[] {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        return [`${modulesDir}/${kebab}/${kebab}.module.ts`];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const [modPath] = this.expectedPaths(ctx);
        const appEdit = buildAppModuleEdit(ctx, name, kebab, modPath);
        return {
          creates: [{ relPath: modPath, content: renderModule(name, kebab) }],
          edits: appEdit ? [appEdit] : [],
        };
      },
    },
    resource: {
      name: 'resource',
      description: 'Scaffold full EntitySpec + DTO + TypeORM Entity + Repo + Service + Controller + Module',
      expectedPaths(ctx: GeneratorContext): string[] {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        const base = `${modulesDir}/${kebab}`;
        return [
          `${base}/${kebab}.entity-spec.ts`,
          `${base}/dto/${kebab}.dto.ts`,
          `${base}/dto/${kebab}.dto.spec.ts`,
          `${base}/${kebab}.entity.ts`,
          `${base}/${kebab}.repository.ts`,
          `${base}/${kebab}.repository.spec.ts`,
          `${base}/${kebab}.service.ts`,
          `${base}/${kebab}.service.spec.ts`,
          `${base}/${kebab}.controller.ts`,
          `${base}/${kebab}.controller.spec.ts`,
          `${base}/${kebab}.module.ts`,
        ];
      },
      plan(ctx: GeneratorContext): PlanResult {
        const name = assertPascalTarget(ctx.target);
        const kebab = toKebab(name);
        const modulesDir = ctx.config.paths.modules ?? 'src/modules';
        const base = `${modulesDir}/${kebab}`;
        const fields = parseFields(ctx.args.fields ?? 'name:str');
        const modPath = `${base}/${kebab}.module.ts`;
        const appEdit = buildAppModuleEdit(ctx, name, kebab, modPath);

        const testFiles = [
          `${base}/dto/${kebab}.dto.spec.ts`,
          `${base}/${kebab}.repository.spec.ts`,
          `${base}/${kebab}.service.spec.ts`,
          `${base}/${kebab}.controller.spec.ts`,
        ];

        return {
          creates: [
            { relPath: `${base}/${kebab}.entity-spec.ts`, content: renderEntitySpec(name, fields) },
            { relPath: `${base}/dto/${kebab}.dto.ts`, content: renderDtoBarrel(name, kebab), generated: true },
            { relPath: `${base}/dto/${kebab}.dto.spec.ts`, content: renderDtoSpec(name, kebab, fields), isTest: true },
            { relPath: `${base}/${kebab}.entity.ts`, content: renderTypeOrmEntity(name, fields) },
            { relPath: `${base}/${kebab}.repository.ts`, content: renderRepository(name, kebab) },
            { relPath: `${base}/${kebab}.repository.spec.ts`, content: renderRepositorySpec(name, kebab), isTest: true },
            { relPath: `${base}/${kebab}.service.ts`, content: renderService(name, kebab) },
            { relPath: `${base}/${kebab}.service.spec.ts`, content: renderServiceSpec(name, kebab), isTest: true },
            { relPath: `${base}/${kebab}.controller.ts`, content: renderController(name, kebab) },
            { relPath: `${base}/${kebab}.controller.spec.ts`, content: renderControllerSpec(name, kebab), isTest: true },
            { relPath: modPath, content: renderModule(name, kebab) },
          ],
          edits: appEdit ? [appEdit] : [],
          testFiles,
        };
      },
    },
    test: {
      name: 'test',
      description: 'Scaffold a sibling Jest .spec.ts file for an existing source file',
      expectedPaths(ctx: GeneratorContext): string[] {
        const rel = ctx.target;
        const ext = path.extname(rel);
        const stem = ext ? rel.slice(0, -ext.length) : rel;
        return [`${stem}.spec.ts`];
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
        const content = `describe('${baseName}', () => {
  it('loads target module test harness', () => {
    expect(true).toBe(true);
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
