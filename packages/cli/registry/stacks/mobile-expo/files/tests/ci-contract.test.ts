import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function object(value: unknown) {
  if (!isObject(value)) throw new Error('Expected a YAML mapping');
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error('Expected string list');
  return value;
}
function steps(job: Record<string, unknown>) {
  if (!Array.isArray(job.steps)) throw new Error('Expected workflow steps');
  return job.steps.map(object);
}
function filters(workflow: unknown) {
  const jobs = object(object(workflow).jobs);
  const filterStep = steps(object(jobs.changes)).find(
    (step) => typeof step.uses === 'string' && step.uses.startsWith('dorny/paths-filter@'),
  );
  if (!filterStep) throw new Error('Missing changes paths-filter');
  const source = object(filterStep.with).filters;
  if (typeof source !== 'string') throw new Error('Expected inline filters YAML');
  return object(Bun.YAML.parse(source));
}
function affected(workflow: unknown, area: string, path: string) {
  return strings(filters(workflow)[area]).some((pattern) => new Bun.Glob(pattern).match(path));
}
export function validateWorkflow(workflow: unknown) {
  const jobs = object(object(workflow).jobs);
  const outputs = object(object(jobs.changes).outputs);
  for (const area of ['api', 'mobile', 'bundle']) {
    expect(outputs[area]).toBe(`\${{ steps.filter.outputs.${area} }}`);
    const job = object(jobs[area]);
    expect(job.needs).toContain('changes');
    expect(String(job.if)).toContain(`needs.changes.outputs.${area} == 'true'`);
    for (const path of [
      'bun.lock',
      'package.json',
      'bunfig.toml',
      'biome.json',
      'tsconfig.base.json',
      '.github/workflows/ci.yml',
    ]) {
      expect(affected(workflow, area, path), `${area} misses ${path}`).toBe(true);
    }
  }
  for (const path of ['apps/api/src/routes/items.ts', 'packages/schemas/src/index.ts']) {
    expect(affected(workflow, 'api', path)).toBe(true);
    expect(affected(workflow, 'mobile', path)).toBe(true);
    expect(affected(workflow, 'bundle', path)).toBe(true);
  }
  expect(affected(workflow, 'mobile', 'apps/mobile/src/app/index.tsx')).toBe(true);
  expect(affected(workflow, 'bundle', 'apps/mobile/src/app/index.tsx')).toBe(true);
  expect(affected(workflow, 'api', 'apps/mobile/src/app/index.tsx')).toBe(false);
  expect(affected(workflow, 'api', 'README.md')).toBe(false);
  const commands = (job: string) =>
    steps(object(jobs[job]))
      .map((step) => step.run)
      .join('\n');
  expect(commands('lint')).toContain('bun run lint');
  expect(commands('typecheck')).toContain('bun run typecheck');
  expect(Object.keys(jobs).some((name) => commands(name).includes('bun run test:ci'))).toBe(true);
  expect(commands('api')).toContain('bun run test:api');
  expect(commands('api')).toContain('bun run db:check');
  expect(commands('api')).toContain('bun run db:migrate');
  expect(commands('mobile')).toContain('bun run test:mobile');
  expect(commands('bundle')).toContain('bun run bundle');
  expect(commands('bundle')).toContain('bun run expo:check');
  const aggregate = object(jobs['ci-ok']);
  expect(String(aggregate.if)).toContain('always()');
  for (const name of Object.keys(jobs).filter((name) => name !== 'ci-ok'))
    expect(aggregate.needs).toContain(name);
  expect(commands('ci-ok')).toContain('failure');
  expect(commands('ci-ok')).toContain('cancelled');
  expect(commands('ci-ok')).toContain('exit 1');
  const resultStep = steps(aggregate).find((step) => typeof step.run === 'string');
  if (!resultStep || typeof resultStep.run !== 'string')
    throw new Error('Missing aggregate script');
  expect(object(resultStep.env).RESULTS).toBe(`\${{ join(needs.*.result, ',') }}`);
  for (const [results, status] of [
    ['success,skipped', 0],
    ['success,failure', 1],
    ['success,cancelled', 1],
  ] as const) {
    const result = spawnSync('bash', ['-e', '-c', resultStep.run], {
      env: { ...process.env, RESULTS: results },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(status);
  }
}
test('the installed workflow preserves the local commands and path contracts', () => {
  const manifest = object(JSON.parse(readFileSync('.stacks/manifest.json', 'utf8')));
  const fragments = manifest.fragments;
  if (!Array.isArray(fragments)) throw new Error('Expected manifest fragments');
  if (!fragments.some((fragment) => object(fragment).id === 'ci-github')) {
    expect(existsSync('.github/workflows/ci.yml')).toBe(false);
    return;
  }
  const workflow: unknown = Bun.YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  validateWorkflow(workflow);
  for (const name of ['lint', 'typecheck']) {
    const missing = structuredClone(workflow);
    const jobs = object(object(missing).jobs);
    delete jobs[name];
    object(jobs['ci-ok']).needs = strings(object(jobs['ci-ok']).needs).filter(
      (needed) => needed !== name,
    );
    expect(() => validateWorkflow(missing)).toThrow();
  }
  const withoutContract = structuredClone(workflow);
  for (const job of Object.values(object(object(withoutContract).jobs))) {
    for (const step of steps(object(job))) {
      if (typeof step.run === 'string')
        step.run = step.run.replaceAll('bun run test:ci', 'echo omitted CI contract');
    }
  }
  expect(() => validateWorkflow(withoutContract)).toThrow();
  // A deliberate broken real filter must fail the same validator.
  const broken = structuredClone(workflow);
  const jobs = object(object(broken).jobs);
  const filterStep = steps(object(jobs.changes)).find((step) => step.id === 'filter');
  if (!filterStep) throw new Error('Missing filter step');
  const mapping = filters(broken);
  mapping.mobile = strings(mapping.mobile).filter(
    (pattern) => !new Bun.Glob(pattern).match('packages/schemas/src/index.ts'),
  );
  object(filterStep.with).filters = Bun.YAML.stringify(mapping);
  expect(() => validateWorkflow(broken)).toThrow();
});
