import * as fs from 'node:fs';
import * as path from 'node:path';
import { runInit } from './init.js';
import { assertSafeRelativePath } from './names.js';
import { JoyError } from './types.js';

export interface NewProjectOptions {
  template: 'sveltekit' | 'nest';
  dryRun?: boolean;
  force?: boolean;
}

export interface NewProjectResult {
  projectName: string;
  template: 'sveltekit' | 'nest';
  targetDir: string;
  files: string[];
}

export function runNewProject(
  cwd: string,
  projectName: string,
  opts: NewProjectOptions
): NewProjectResult {
  assertSafeRelativePath(cwd, projectName);
  if (projectName.includes('/') || projectName.includes('\\')) {
    throw new JoyError(
      'E_USAGE',
      `Invalid project name "${projectName}". Must be a single directory name.`,
      2
    );
  }

  const targetDir = path.join(cwd, projectName);
  if (fs.existsSync(targetDir) && !opts.force) {
    const entries = fs.readdirSync(targetDir);
    if (entries.length > 0) {
      throw new JoyError(
        'E_EXISTS',
        `Directory "${projectName}" already exists and is not empty. Pass --force to overwrite.`,
        2
      );
    }
  }

  const filesToWrite: Record<string, string> = {};

  if (opts.template === 'sveltekit') {
    filesToWrite['package.json'] = `${JSON.stringify(
      {
        name: projectName,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite dev',
          build: 'vite build',
          check: 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json',
          'test:unit': 'vitest run',
        },
        dependencies: {
          '@montionugera/joy-svelte': '^0.2.1',
      '@montionugera/joy-tokens': '^0.2.1',
          '@montionugera/joy-icons': '^0.3.0',
          '@montionugera/joy-brand': '^0.2.0',
        },
        devDependencies: {
          '@sveltejs/kit': '^2.50.0',
          '@sveltejs/vite-plugin-svelte': '^5.0.0',
          svelte: '^5.0.0',
          'svelte-check': '^4.0.0',
          typescript: '^5.6.0',
          vite: '^6.0.0',
          vitest: '^3.0.0',
        },
      },
      null,
      2
    )}\n`;
    filesToWrite['svelte.config.js'] = `export default {
  kit: {},
};
`;
    filesToWrite['tsconfig.json'] = `${JSON.stringify(
      {
        extends: './.svelte-kit/tsconfig.json',
        compilerOptions: {
          strict: true,
          skipLibCheck: true,
        },
      },
      null,
      2
    )}\n`;
    filesToWrite['src/routes/+page.svelte'] = `<script lang="ts">
  let { data } = $props();
</script>

<main class="joy-page" style="padding: var(--joy-space-6); color: var(--joy-text-primary);">
  <h1>Welcome to ${projectName}</h1>
</main>
`;
  } else {
    filesToWrite['package.json'] = `${JSON.stringify(
      {
        name: projectName,
        version: '0.1.0',
        private: true,
        scripts: {
          build: 'tsc -p tsconfig.json --noEmit',
          test: 'jest',
        },
        jest: {
          moduleFileExtensions: ['js', 'json', 'ts'],
          rootDir: '.',
          testRegex: '.*\\.spec\\.ts$',
          transform: {
            '^.+\\.ts$': 'ts-jest',
          },
          testEnvironment: 'node',
        },
        dependencies: {
          '@montionugera/entity-spec': '^2.0.28',
          '@montionugera/entity-spec-gen-openapi': '^2.0.28',
          '@montionugera/entity-spec-gen-zod': '^2.0.28',
          '@montionugera/server-decorator': '^2.0.28',
          '@nestjs/common': '^10.0.0',
          '@nestjs/core': '^10.0.0',
          '@nestjs/typeorm': '^10.0.0',
          'reflect-metadata': '^0.2.0',
          typeorm: '^0.3.20',
          zod: '^3.23.8',
        },
        devDependencies: {
          '@types/jest': '^29.5.0',
          '@types/node': '^22.0.0',
          jest: '^29.7.0',
          'ts-jest': '^29.2.0',
          typescript: '^5.6.0',
        },
      },
      null,
      2
    )}\n`;
    filesToWrite['tsconfig.json'] = `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          skipLibCheck: true,
          types: ['node', 'jest'],
        },
      },
      null,
      2
    )}\n`;
    filesToWrite['src/modules/main/app.module.ts'] = `import { Module } from '@nestjs/common';
// joy:anchor app-module-imports

@Module({
  imports: [
    // joy:anchor app-module-declarations
  ],
})
export class AppModule {}
`;
  }

  const createdFiles = Object.keys(filesToWrite);
  if (!opts.dryRun) {
    for (const [rel, content] of Object.entries(filesToWrite)) {
      const abs = path.join(targetDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    }
    const initRes = runInit(targetDir, { dryRun: false });
    for (const f of initRes.touchedFiles) {
      if (!createdFiles.includes(f)) createdFiles.push(f);
    }
  } else {
    createdFiles.push('.npmrc', 'joy.config.json');
  }

  return {
    projectName,
    template: opts.template,
    targetDir,
    files: createdFiles.sort(),
  };
}
