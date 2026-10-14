import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isIgnored, readEnvValue, writeEnv } from '../src/env.js';
import { tempDir } from './helpers.js';

test('creates the file when there is none', () => {
  const file = join(tempDir(), '.env.local');
  assert.deepEqual(writeEnv(file, { RUNOMINE_TOKEN: 'rm_live_abc' }), { RUNOMINE_TOKEN: 'added' });
  assert.equal(readFileSync(file, 'utf8'), 'RUNOMINE_TOKEN=rm_live_abc\n');
});

test('appends without touching the rest, and never clobbers a key that has a value', () => {
  const file = join(tempDir(), '.env');
  writeFileSync(file, '# app\nAPP_KEY=base64:xyz==\nRUNOMINE_TOKEN=rm_live_old\nEMPTY=\n');
  const result = writeEnv(file, { RUNOMINE_TOKEN: 'rm_live_new', RUNOMINE_URL: 'http://localhost:8040', EMPTY: 'filled' });
  assert.deepEqual(result, { RUNOMINE_TOKEN: 'kept', RUNOMINE_URL: 'added', EMPTY: 'added' });
  assert.equal(readFileSync(file, 'utf8'), '# app\nAPP_KEY=base64:xyz==\nRUNOMINE_TOKEN=rm_live_old\nEMPTY=filled\nRUNOMINE_URL=http://localhost:8040\n');
});

test('overwrites only when asked, and quotes what needs it', () => {
  const file = join(tempDir(), '.env');
  writeFileSync(file, 'export RUNOMINE_TOKEN="rm_live_old"\nOTHER=1');
  assert.deepEqual(writeEnv(file, { RUNOMINE_TOKEN: 'rm_live_new' }, { overwrite: true }), { RUNOMINE_TOKEN: 'updated' });
  writeEnv(file, { NAME: 'two words' });
  assert.equal(readFileSync(file, 'utf8'), 'RUNOMINE_TOKEN=rm_live_new\nOTHER=1\nNAME="two words"\n');
  assert.equal(readEnvValue(file, 'RUNOMINE_TOKEN'), 'rm_live_new');
  assert.equal(readEnvValue(file, 'MISSING'), null);
});

test('knows when .gitignore keeps the env file out', () => {
  const dir = tempDir();
  assert.equal(isIgnored(dir, '.env'), false);
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.env*.local\n/.env\n');
  assert.equal(isIgnored(dir, '.env'), true);
  assert.equal(isIgnored(dir, '.env.local'), true);
  assert.equal(isIgnored(dir, '.envrc'), false);
});
