import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

export function clientGraph(entry: string, root = resolve('src')) {
  const realRoot = realpathSync(root);
  const seen = new Set<string>();
  const violations: string[] = [];
  function visit(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const owner = relative(realRoot, file).replaceAll('\\', '/');
    if (owner.startsWith('middleware/')) violations.push(`${owner}: middleware`);
    // Include erased type imports/exports as well as runtime and dynamic imports.
    const imports = source.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g,
    );
    for (const match of imports) {
      const name = match[1];
      if (!name) continue;
      if (
        ((name === 'bun' || name.startsWith('bun:')) && owner !== 'db/index.ts') ||
        (name.startsWith('drizzle-orm') && !/^(services|db)\//.test(owner)) ||
        name.startsWith('@clerk/')
      ) {
        violations.push(`${owner}: ${name}`);
      }
      if (name === 'bun' || name.startsWith('bun:') || name.startsWith('node:')) continue;
      const target = realpathSync(Bun.resolveSync(name, dirname(file)));
      // Follow local, aliased and workspace code, but stop at installed packages.
      if (!target.includes('/node_modules/') && /\.[cm]?[jt]sx?$/.test(target)) visit(target);
    }
  }
  visit(realpathSync(entry));
  return violations;
}
