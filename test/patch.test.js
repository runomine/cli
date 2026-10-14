import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { detect } from '../src/detect.js';
import { NEXT_MIDDLEWARE, nextMiddleware, patchDjango } from '../src/patch.js';
import { copyFixture } from './helpers.js';

test('next: creates middleware.ts under src/, only when there is none', () => {
  const dir = copyFixture('next-app');
  const result = nextMiddleware(detect(dir));
  assert.deepEqual(result, { created: true, file: 'src/middleware.ts' });
  assert.equal(readFileSync(join(dir, 'src', 'middleware.ts'), 'utf8'), NEXT_MIDDLEWARE);
  const again = nextMiddleware(detect(dir));
  assert.equal(again.created, false);
  assert.equal(again.file, 'src/middleware.ts');
});

test('next 16 without TypeScript: proxy.js at the root; an existing middleware is left alone', () => {
  const dir = copyFixture('next-app');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  pkg.dependencies.next = '^16.0.0';
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(dir, 'tsconfig.json'), '');
  const project = { ...detect(dir), typescript: false, srcDir: false };
  assert.deepEqual(nextMiddleware(project), { created: true, file: 'proxy.js' });

  const other = copyFixture('next-app');
  writeFileSync(join(other, 'middleware.ts'), 'export default function m() {}\n');
  const result = nextMiddleware(detect(other));
  assert.equal(result.created, false);
  assert.equal(result.existing, 'export default function m() {}\n');
  assert.equal(existsSync(join(other, 'src', 'middleware.ts')), false);
});

test('django: inserted right after the auth middleware, once', () => {
  const dir = copyFixture('django');
  const result = patchDjango(dir);
  assert.equal(result.patched, true);
  assert.equal(result.file, 'mysite/settings.py');
  const text = readFileSync(join(dir, 'mysite', 'settings.py'), 'utf8');
  assert.match(text, /'django\.contrib\.auth\.middleware\.AuthenticationMiddleware',\n    'runomine\.django\.RunomineMiddleware',\n    'django\.contrib\.messages/);
  assert.equal(patchDjango(dir).already, true);
  assert.equal(readFileSync(join(dir, 'mysite', 'settings.py'), 'utf8'), text);
});

test('django: anything unusual is left for the person, with the diff', () => {
  const dir = copyFixture('django');
  writeFileSync(join(dir, 'mysite', 'settings.py'), 'MIDDLEWARE = BASE_MIDDLEWARE + []\n');
  let result = patchDjango(dir);
  assert.equal(result.patched, false);
  assert.match(result.diff, /\+ {4}'runomine\.django\.RunomineMiddleware',/);
  mkdirSync(join(dir, 'other'));
  writeFileSync(join(dir, 'other', 'settings.py'), '');
  result = patchDjango(dir);
  assert.match(result.reason, /several settings files/);
});
