import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detect, hostOf } from '../src/detect.js';
import { copyFixture, fixtures, tempDir } from './helpers.js';

const pick = (p) => ({ framework: p.framework, language: p.language, packageManager: p.packageManager, envFile: p.envFile, guide: p.guide, name: p.name, domain: p.domain });

test('laravel: composer, .env, the domain from APP_URL', () => {
  assert.deepEqual(pick(detect(copyFixture('laravel'))), {
    framework: 'laravel', language: 'php', packageManager: 'composer', envFile: '.env', guide: 'laravel', name: 'shop', domain: 'shop.example.com',
  });
});

test('next: pnpm from the lockfile, .env.local, src/ layout and TypeScript', () => {
  const p = detect(`${fixtures}next-app`);
  assert.deepEqual(pick(p), { framework: 'next', language: 'node', packageManager: 'pnpm', envFile: '.env.local', guide: 'nextjs', name: 'storefront', domain: null });
  assert.equal(p.nextMajor, 15);
  assert.equal(p.typescript, true);
  assert.equal(p.srcDir, true);
});

test('express with yarn; other node with bun from packageManager and the homepage domain', () => {
  assert.deepEqual(pick(detect(`${fixtures}express`)), { framework: 'express', language: 'node', packageManager: 'yarn', envFile: '.env', guide: 'express', name: 'api', domain: null });
  assert.deepEqual(pick(detect(`${fixtures}node-plain`)), { framework: 'node', language: 'node', packageManager: 'bun', envFile: '.env', guide: 'express', name: 'worker', domain: 'worker.example.org' });
});

test('python: django with pip, fastapi with uv, fastapi with poetry', () => {
  assert.deepEqual(pick(detect(`${fixtures}django`)), { framework: 'django', language: 'python', packageManager: 'pip', envFile: '.env', guide: 'django', name: 'django', domain: null });
  assert.deepEqual(pick(detect(`${fixtures}fastapi-uv`)), { framework: 'fastapi', language: 'python', packageManager: 'uv', envFile: '.env', guide: 'fastapi', name: 'billing-api', domain: null });
  assert.equal(detect(`${fixtures}poetry-fastapi`).packageManager, 'poetry');
  assert.equal(detect(`${fixtures}poetry-fastapi`).framework, 'fastapi');
});

test('rust: axum, actix-web', () => {
  assert.deepEqual(pick(detect(`${fixtures}axum`)), { framework: 'axum', language: 'rust', packageManager: 'cargo', envFile: '.env', guide: 'rust', name: 'shop-server', domain: null });
  assert.equal(detect(`${fixtures}actix`).framework, 'actix');
});

test('anything else is a static site: the script tag, the domain from CNAME', () => {
  assert.deepEqual(pick(detect(`${fixtures}static`)), { framework: 'static', language: 'html', packageManager: null, envFile: null, guide: 'html', name: 'static', domain: 'www.static-site.net' });
  assert.equal(detect(tempDir()).framework, 'static');
});

test('local hosts are no domain', () => {
  for (const local of ['http://localhost:8000', 'http://127.0.0.1', 'https://shop.test', 'app.local', '', null]) assert.equal(hostOf(local), null, String(local));
  assert.equal(hostOf('https://www.Shop.com/x'), 'www.shop.com');
});
