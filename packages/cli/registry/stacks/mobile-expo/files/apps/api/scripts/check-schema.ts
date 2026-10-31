import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Generate against a copy: a schema edit without a migration must fail check.
const temporary = mkdtempSync('.drizzle-check-');
const output = join(temporary, 'drizzle');
try {
  cpSync('drizzle', output, { recursive: true });
  const before = readdirSync(output).filter((name) => name.endsWith('.sql'));
  const result = spawnSync(
    'bun',
    [
      'x',
      'drizzle-kit',
      'generate',
      '--dialect=postgresql',
      '--schema=./src/db/schema.ts',
      `--out=${output}`,
    ],
    { encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  process.stdout.write(result.stdout);
  if (result.status !== 0 || result.stderr.trim())
    throw new Error(`Migration generation failed: ${result.stderr}`);
  if (
    !result.stdout.includes('No schema changes') ||
    readdirSync(output).filter((name) => name.endsWith('.sql')).length !== before.length
  ) {
    throw new Error('Schema changed without a migration. Run bun run db:generate.');
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
