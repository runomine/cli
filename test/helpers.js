import { cpSync, existsSync, mkdtempSync, renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const fixtures = new URL('./fixtures/', import.meta.url).pathname;

/** A copy of a fixture project in a temp dir (its .env.fixture becomes .env), safe to change. */
export function copyFixture(name) {
  const dir = mkdtempSync(join(tmpdir(), `runomine-${name}-`));
  cpSync(join(fixtures, name), dir, { recursive: true });
  if (existsSync(join(dir, '.env.fixture'))) renameSync(join(dir, '.env.fixture'), join(dir, '.env'));
  return dir;
}

export function tempDir(prefix = 'runomine-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * A fake runomine API: routes is { 'GET /api/v1/me': (req, body) => [status, json] }. Records every request.
 * Resolves to { url, requests, close }.
 */
export function fakeServer(routes) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const path = req.url.split('?')[0];
      requests.push({ method: req.method, path, url: req.url, headers: req.headers, body });
      const handler = routes[`${req.method} ${path}`];
      const [status, json] = handler ? handler(req, body) : [404, { error: { code: 'not_found', message: `No route ${req.method} ${path}` } }];
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  })));
}
