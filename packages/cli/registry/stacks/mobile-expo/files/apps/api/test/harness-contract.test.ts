import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { db } from '../src/db';
import { clientGraph } from './import-graph';
import { createTestDatabase, migrationCount, setupApiTest, withTestDatabase } from './setup';

const t = setupApiTest('harness');
test('apps retain their own database when another app changes process env in the same process', async () => {
  const other = await createTestDatabase('binding');
  const previousUrl = process.env.DATABASE_URL;
  try {
    const { createApp } = await import('../src/app');
    const first = createApp(t.database.url);
    const second = createApp(other.url);
    await t.db.insert(t.schema.items).values({ name: 'first-app' });
    await db(other.url).db.insert(t.schema.items).values({ name: 'second-app' });
    process.env.DATABASE_URL = other.url;
    expect(await (await first.request('/items')).json()).toEqual({
      items: [{ id: 1, name: 'first-app' }],
    });
    process.env.DATABASE_URL = t.database.url;
    expect(await (await second.request('/items')).json()).toEqual({
      items: [{ id: 1, name: 'second-app' }],
    });
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await other.drop();
  }
});
test('reuses one migrated template and cleans a failed fixture without dropping a neighbour', async () => {
  const neighbour = await createTestDatabase('neighbour');
  let failedName = '';
  try {
    await expect(
      withTestDatabase('failed', async (database) => {
        failedName = database.name;
        throw new Error('fixture setup failed');
      }),
    ).rejects.toThrow('fixture setup failed');
    expect(await t.sql`select datname from pg_database where datname = ${failedName}`).toHaveLength(
      0,
    );
    expect(
      await t.sql`select datname from pg_database where datname = ${neighbour.name}`,
    ).toHaveLength(1);
    expect(migrationCount()).toBe(1);
  } finally {
    await neighbour.drop();
  }
});
test('two real API files execute in parallel against isolated databases', async () => {
  const run = (file: string) =>
    new Promise<void>((done, reject) => {
      const child = spawn('bun', ['test', file], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.on('error', reject);
      child.on('close', (status) => (status === 0 ? done() : reject(new Error(output))));
    });
  await Promise.all([run('test/isolation-a.test.ts'), run('test/isolation-b.test.ts')]);
});
test('client types follow the intended routes -> services -> db graph', () => {
  expect(clientGraph('src/client.ts')).toEqual([]);
});
test('graph enforcement follows aliases and workspace exports with deny and near-miss fixtures', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'client-graph-'));
  try {
    mkdirSync(join(fixture, 'services'));
    writeFileSync(
      join(fixture, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { paths: { '@/*': ['./*'], '@auth': ['./middleware/auth.ts'] } },
      }),
    );
    writeFileSync(join(fixture, 'client.ts'), "export type { Hidden } from '@/hidden';\n");
    writeFileSync(
      join(fixture, 'hidden.ts'),
      "import { SQL } from 'bun'; export type Hidden = typeof SQL;\n",
    );
    expect(clientGraph(join(fixture, 'client.ts'), fixture)).toEqual(['hidden.ts: bun']);
    mkdirSync(join(fixture, 'middleware'));
    writeFileSync(join(fixture, 'middleware/auth.ts'), 'export type Hidden = string;\n');
    writeFileSync(join(fixture, 'client.ts'), "export type { Hidden } from '@auth';\n");
    expect(clientGraph(join(fixture, 'client.ts'), fixture)).toEqual([
      'middleware/auth.ts: middleware',
    ]);
    mkdirSync(join(fixture, 'node_modules'));
    mkdirSync(join(fixture, 'workspace'));
    symlinkSync(join(fixture, 'workspace'), join(fixture, 'node_modules/graph-workspace'));
    symlinkSync(
      dirname(Bun.resolveSync('drizzle-orm/package.json', import.meta.dir)),
      join(fixture, 'node_modules/drizzle-orm'),
    );
    writeFileSync(
      join(fixture, 'workspace/package.json'),
      JSON.stringify({ name: 'graph-workspace', exports: './index.ts' }),
    );
    writeFileSync(
      join(fixture, 'workspace/index.ts'),
      "import { eq } from 'drizzle-orm'; export type Hidden = typeof eq;\n",
    );
    writeFileSync(join(fixture, 'client.ts'), "export type { Hidden } from 'graph-workspace';\n");
    expect(clientGraph(join(fixture, 'client.ts'), fixture)).toEqual([
      'workspace/index.ts: drizzle-orm',
    ]);
    writeFileSync(join(fixture, 'workspace/index.ts'), "export type { Hidden } from '@auth';\n");
    expect(clientGraph(join(fixture, 'client.ts'), fixture)).toEqual([
      'middleware/auth.ts: middleware',
    ]);
    // A real workspace symlink resolves to source outside node_modules.
    writeFileSync(join(fixture, 'client.ts'), "export type { Hidden } from './services/hidden';\n");
    mkdirSync(join(fixture, 'db'));
    writeFileSync(join(fixture, 'db/index.ts'), "export type { SQL } from 'bun';\n");
    writeFileSync(
      join(fixture, 'services/hidden.ts'),
      "export type { SQL as Hidden } from '../db';\n",
    );
    expect(clientGraph(join(fixture, 'client.ts'), fixture)).toEqual([]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
