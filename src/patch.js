// The few code changes `runomine init` makes, only where there's exactly one safe way to make them. Everything else
// is printed for the person to paste.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const NEXT_MIDDLEWARE = `import { withRunomine } from '@runomine/node/next';

// runomine: a pageview for every page request, sent after the response (docs: @runomine/node, Next.js).
export default withRunomine();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
`;

/**
 * Next.js: creates middleware.ts (proxy.ts on Next 16+, .js without TypeScript, under src/ with that layout) when the
 * project has none. With one already there, nothing is touched: the result says how to wrap it.
 *
 * @returns {{ created: boolean, file: string, existing?: string }}
 */
export function nextMiddleware(project, { write = true } = {}) {
  const base = project.srcDir ? join(project.dir, 'src') : project.dir;
  const existing = ['middleware.ts', 'middleware.js', 'proxy.ts', 'proxy.js']
    .flatMap((f) => [join(project.dir, f), join(project.dir, 'src', f)])
    .find((f) => existsSync(f));
  const file = join(base, `${project.nextMajor >= 16 ? 'proxy' : 'middleware'}.${project.typescript ? 'ts' : 'js'}`);
  if (existing) return { created: false, file: relative(project.dir, existing), existing: readFileSync(existing, 'utf8') };
  if (write) writeFileSync(file, NEXT_MIDDLEWARE);
  return { created: true, file: relative(project.dir, file) };
}

/** Django's settings modules near the project root: settings.py, <dir>/settings.py, <dir>/settings/base.py. */
export function findDjangoSettings(dir) {
  const found = [];
  const look = (path) => existsSync(path) && found.push(path);
  look(join(dir, 'settings.py'));
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || ['node_modules', 'venv', '.venv', 'env'].includes(entry.name)) continue;
    look(join(dir, entry.name, 'settings.py'));
    look(join(dir, entry.name, 'settings', 'base.py'));
  }
  return found;
}

const DJANGO_LINE = 'runomine.django.RunomineMiddleware';
const AUTH_LINE = 'django.contrib.auth.middleware.AuthenticationMiddleware';

/**
 * Django: adds RunomineMiddleware to MIDDLEWARE right after the auth middleware, when there's one settings file with
 * one plain MIDDLEWARE = [...] list that has it on a line of its own. Otherwise nothing changes and the result has
 * the exact diff to apply by hand.
 *
 * @returns {{ patched: boolean, already?: boolean, file?: string, diff: string, reason?: string }}
 */
export function patchDjango(dir, { write = true } = {}) {
  const diff = `MIDDLEWARE = [\n     ...\n     '${AUTH_LINE}',\n+    '${DJANGO_LINE}',\n     ...\n ]`;
  const files = findDjangoSettings(dir);
  if (files.length !== 1) return { patched: false, diff, reason: files.length ? `several settings files (${files.map((f) => relative(dir, f)).join(', ')})` : 'no settings.py found' };
  const file = files[0];
  const text = readFileSync(file, 'utf8');
  const lists = [...text.matchAll(/^MIDDLEWARE\s*=\s*\[([\s\S]*?)^\]/gm)];
  if (lists.length !== 1) return { patched: false, file: relative(dir, file), diff, reason: 'MIDDLEWARE isn\'t one plain list' };
  if (lists[0][1].includes(DJANGO_LINE)) return { patched: false, already: true, file: relative(dir, file), diff };
  const lines = lists[0][1].split('\n');
  const auth = lines.findIndex((l) => new RegExp(`^\\s*(['"])${AUTH_LINE.replace(/\./g, '\\.')}\\1,\\s*$`).test(l));
  if (auth === -1) return { patched: false, file: relative(dir, file), diff, reason: 'no AuthenticationMiddleware line to put it after' };
  const [, indent, q] = lines[auth].match(/^(\s*)(['"])/);
  lines.splice(auth + 1, 0, `${indent}${q}${DJANGO_LINE}${q},`);
  const patched = text.replace(lists[0][1], lines.join('\n'));
  if (write) writeFileSync(file, patched);
  return { patched: true, file: relative(dir, file), diff };
}
