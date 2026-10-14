import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { detect } from '../src/detect.js';
import { installPlan, resolveSource, shellLine } from '../src/install.js';
import { copyFixture, fixtures, tempDir } from './helpers.js';

const repo = resolve(new URL('../..', import.meta.url).pathname);
const cmds = (plan) => plan.steps.filter((s) => s.cmd).map((s) => shellLine(s.cmd));
// The tarball is named after sdks/node's version (install.js reads it the same way; 0.1.0 when there is no sdks/,
// as in the CLI's own repository).
const nodeManifest = join(repo, 'sdks', 'node', 'package.json');
const nodeTarball = `runomine-node-${existsSync(nodeManifest) ? JSON.parse(readFileSync(nodeManifest, 'utf8')).version : '0.1.0'}.tgz`;

test('the source: this checkout by default, else the public repos; a path, a git URL, github or the registry', () => {
  assert.deepEqual(resolveSource(undefined), { kind: 'path', root: repo });
  assert.deepEqual(resolveSource(undefined, { cliDir: tempDir() }), { kind: 'registry' });
  assert.deepEqual(resolveSource('github'), { kind: 'public' });
  assert.deepEqual(resolveSource(repo), { kind: 'path', root: repo });
  assert.deepEqual(resolveSource(join(repo, 'sdks')), { kind: 'path', root: repo });
  assert.deepEqual(resolveSource('git@github.com:acme/runomine.git'), { kind: 'git', url: 'git@github.com:acme/runomine.git' });
  assert.deepEqual(resolveSource('git+https://github.com/acme/runomine.git'), { kind: 'git', url: 'https://github.com/acme/runomine.git' });
  assert.deepEqual(resolveSource('registry'), { kind: 'registry' });
  assert.throws(() => resolveSource(tempDir()), /not a checkout/);
});

test('laravel: a path repository and composer require', () => {
  const plan = installPlan(detect(copyFixture('laravel')), { kind: 'path', root: repo });
  assert.deepEqual(cmds(plan), [
    `composer config repositories.runomine '{"type":"path","url":"${repo}/sdks/php","options":{"symlink":false}}'`,
    "composer require 'runomine/runomine-php:*@dev'",
  ]);
  assert.deepEqual(cmds(installPlan(detect(copyFixture('laravel')), { kind: 'registry' })), ['composer require runomine/runomine-php']);
});

test('node: the tarball vendored, added with the project package manager', () => {
  const dir = `${fixtures}next-app`;
  const plan = installPlan(detect(dir), { kind: 'path', root: repo });
  assert.deepEqual(cmds(plan), [
    `npm pack ${repo}/sdks/node --pack-destination ${dir}/vendor --silent`,
    `pnpm add ./vendor/${nodeTarball}`,
  ]);
  assert.equal(cmds(installPlan(detect(`${fixtures}express`), { kind: 'path', root: repo }))[1], `yarn add file:./vendor/${nodeTarball}`);
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}node-plain`), { kind: 'registry' })), ['bun add @runomine/node']);
  // From git: cloned first (composer and npm need the files).
  const fromGit = installPlan(detect(dir), { kind: 'git', url: 'https://example.com/runomine.git' }, { env: { XDG_CACHE_HOME: '/cache' } });
  assert.deepEqual(fromGit.clone, { url: 'https://example.com/runomine.git', dir: '/cache/runomine/repo' });
});

test('python: uv and poetry add; pip into the virtualenv and requirements.txt', () => {
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}fastapi-uv`), { kind: 'path', root: repo })), [`uv add ${repo}/sdks/python`]);
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}poetry-fastapi`), { kind: 'git', url: 'https://example.com/r.git' })),
    ["poetry add 'git+https://example.com/r.git#subdirectory=sdks/python'"]);
  const dir = copyFixture('django');
  let plan = installPlan(detect(dir), { kind: 'git', url: 'https://example.com/r.git' });
  assert.equal(plan.steps[0].append.line, 'runomine @ git+https://example.com/r.git#subdirectory=sdks/python');
  assert.match(plan.steps[1].note, /No virtualenv/);
  mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
  writeFileSync(join(dir, '.venv', 'bin', 'python'), '');
  plan = installPlan(detect(dir), { kind: 'registry' });
  assert.deepEqual(cmds(plan), [`${dir}/.venv/bin/python -m pip install runomine`]);
});

test('rust: cargo add with the framework feature', () => {
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}axum`), { kind: 'path', root: repo })), [`cargo add runomine --path ${repo}/sdks/rust --features axum`]);
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}actix`), { kind: 'git', url: 'https://example.com/r.git' })), ['cargo add runomine --git https://example.com/r.git --features actix-web']);
});

const pub = { kind: 'public' };

test('public, php: the GitHub repo as a vcs repository, dev-main', () => {
  const plan = installPlan(detect(copyFixture('laravel')), pub);
  assert.deepEqual(cmds(plan), [
    `composer config repositories.runomine '{"type":"vcs","url":"https://github.com/runomine/runomine-php"}'`,
    'composer require runomine/runomine-php:dev-main',
  ]);
  assert.equal(plan.clone, undefined);
});

test('public, node: added from github: with the project package manager, no clone', () => {
  const plan = installPlan(detect(`${fixtures}next-app`), pub);
  assert.deepEqual(cmds(plan), ['pnpm add github:runomine/runomine-node']);
  assert.equal(plan.clone, undefined);
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}express`), pub)), ['yarn add github:runomine/runomine-node']);
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}node-plain`), pub)), ['bun add github:runomine/runomine-node']);
});

test('public, python: the GitHub repo, no subdirectory', () => {
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}fastapi-uv`), pub)), ["uv add 'runomine @ git+https://github.com/runomine/runomine-python.git'"]);
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}poetry-fastapi`), pub)), ['poetry add git+https://github.com/runomine/runomine-python.git']);
  const plan = installPlan(detect(copyFixture('django')), pub);
  assert.equal(plan.steps[0].append.line, 'runomine @ git+https://github.com/runomine/runomine-python.git');
  assert.match(plan.steps[1].note, /pip install "runomine @ git\+https:\/\/github.com\/runomine\/runomine-python.git"/);
});

test('public, rust: cargo add from the GitHub repo', () => {
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}axum`), pub)), ['cargo add runomine --git https://github.com/runomine/runomine-rust --features axum']);
  assert.deepEqual(cmds(installPlan(detect(`${fixtures}actix`), pub)), ['cargo add runomine --git https://github.com/runomine/runomine-rust --features actix-web']);
});

test('static sites install nothing', () => {
  assert.deepEqual(installPlan(detect(`${fixtures}static`), { kind: 'registry' }).steps, []);
});
