import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Api, ApiError, matchSite } from '../src/api.js';
import { main } from '../src/cli.js';
import { copyFixture, fakeServer, tempDir } from './helpers.js';

const SITE = { id: 'site_abcdefghijkl', name: 'Storefront', slug: 'storefront', domain: 'store.example.com', workspace: { slug: 'acme', name: 'Acme' }, permissions: { manage: true, delete: true }, last_received_at: null };
const GUIDE = { nextjs: { label: 'Next.js', steps: [
  { caption: 'Install', code: 'npm install @runomine/node' },
  { caption: '.env.local', code: 'RUNOMINE_TOKEN=rm_live_…' },
  { caption: 'middleware.ts', code: 'export default withRunomine();' },
  { caption: 'A route handler', code: "track('checkout_started')" },
] } };

let server;
let polls = 0;
let sites = [];

before(async () => {
  server = await fakeServer({
    'POST /api/v1/auth/device': () => [201, { device_code: 'dev-123', user_code: 'BCDF-GHJK', verification_url: 'http://x/cli/authorize', verification_url_complete: 'http://x/cli/authorize?code=BCDF-GHJK', expires_in: 600, interval: 0 }],
    'POST /api/v1/auth/token': (req, body) => (body.device_code !== 'dev-123' ? [400, { error: { code: 'expired_token', message: 'Expired.' } }]
      : ++polls < 2 ? [400, { error: { code: 'authorization_pending', message: 'Waiting.' } }] : [200, { access_token: '7|rm_pat_secret', token_type: 'Bearer' }]),
    'GET /api/v1/me': (req) => (req.headers.authorization === 'Bearer 7|rm_pat_secret'
      ? [200, { user: { id: 1, name: 'Olga', email: 'olga@example.com' }, token: { name: 'CLI' }, workspaces: [{ slug: 'acme', name: 'Acme', role: 'owner', permissions: { manage: true } }] }]
      : [401, { error: { code: 'unauthenticated', message: 'A valid personal access token is required.' } }]),
    'GET /api/v1/sites': () => [200, { data: sites }],
    'POST /api/v1/sites': (req, body) => {
      const site = { ...SITE, name: body.name, domain: body.domain };
      sites.push(site);
      return [201, { data: site, token: 'rm_live_NEWTOKEN123', install: GUIDE }];
    },
    [`GET /api/v1/sites/${SITE.id}/install`]: () => [200, { site: SITE.id, install: GUIDE }],
    [`GET /api/v1/sites/${SITE.id}/live`]: () => [200, { last_pageview_at: '2026-10-14T10:00:00Z', recent: [{ kind: 'pageview', what: '/' }] }],
    'DELETE /api/v1/auth/token': () => [200, { revoked: true }],
  });
});

after(() => server.close());

test('the client sends the token and turns errors into ApiError with the code', async () => {
  const api = new Api({ url: server.url, token: 'nope' });
  await assert.rejects(api.get('/me'), (e) => e instanceof ApiError && e.status === 401 && e.code === 'unauthenticated' && /runomine login/.test(e.message));
  await assert.rejects(new Api({ url: server.url }).get('/me'), /Not logged in/);
  await assert.rejects(new Api({ url: 'http://127.0.0.1:9', token: 'x' }).get('/me'), (e) => e.code === 'network_error');
  const ok = await new Api({ url: server.url, token: '7|rm_pat_secret' }).get('/me');
  assert.equal(ok.user.email, 'olga@example.com');
  const sent = server.requests.at(-1);
  assert.equal(sent.headers.authorization, 'Bearer 7|rm_pat_secret');
  assert.equal(sent.headers.accept, 'application/json');
});

test('sites are matched by id, slug, name or domain', () => {
  const list = [SITE, { ...SITE, id: 'site_other', name: 'Blog', slug: 'blog', domain: 'blog.example.com' }];
  assert.equal(matchSite(list, 'site_abcdefghijkl').site.name, 'Storefront');
  assert.equal(matchSite(list, 'BLOG').site.id, 'site_other');
  assert.equal(matchSite(list, 'https://www.store.example.com/').site.id, SITE.id);
  assert.equal(matchSite(list, 'nothing').site, null);
});

test('login: device code, polling until approved, token saved 0600; logout revokes it', async () => {
  const config = join(tempDir(), 'config.json');
  const env = { ...process.env, RUNOMINE_CONFIG: config, RUNOMINE_URL: server.url };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    assert.equal(await main(['login', '--no-open']), 0);
    const stored = JSON.parse(readFileSync(config, 'utf8'));
    assert.equal(stored.token, '7|rm_pat_secret');
    assert.equal(stored.email, 'olga@example.com');
    assert.equal(stored.url, server.url);
    assert.equal(statSync(config).mode & 0o777, 0o600);
    assert.equal(polls, 2);

    assert.equal(await main(['logout']), 0);
    assert.equal(JSON.parse(readFileSync(config, 'utf8')).token, undefined);
    assert.equal(server.requests.at(-1).method, 'DELETE');
  } finally {
    process.env = saved;
  }
});

test('init --yes on a Next.js app: creates the site, writes .env.local, adds the middleware, sees the first event', async () => {
  const dir = copyFixture('next-app');
  const config = join(tempDir(), 'config.json');
  const saved = { ...process.env };
  Object.assign(process.env, { RUNOMINE_CONFIG: config, RUNOMINE_URL: server.url, RUNOMINE_PAT: '7|rm_pat_secret' });
  sites = [];
  try {
    assert.equal(await main(['init', '--yes', '--dir', dir, '--domain', 'store.example.com', '--no-install', '--wait', '5']), 0);
    assert.equal(readFileSync(join(dir, '.env.local'), 'utf8'), `RUNOMINE_TOKEN=rm_live_NEWTOKEN123\nRUNOMINE_URL=${server.url}\n`);
    assert.ok(existsSync(join(dir, 'src', 'middleware.ts')));
    assert.equal(JSON.parse(readFileSync(config, 'utf8')).defaultSite, SITE.id);
    const created = server.requests.find((r) => r.method === 'POST' && r.path === '/api/v1/sites');
    assert.deepEqual(created.body, { name: 'storefront', domain: 'store.example.com' });

    // Again, on the same project: the site is found by its domain and the token in .env.local is kept.
    assert.equal(await main(['init', '--yes', '--dir', dir, '--domain', 'https://www.store.example.com', '--no-install', '--no-wait']), 0);
    assert.equal(server.requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/sites').length, 1);
    assert.match(readFileSync(join(dir, '.env.local'), 'utf8'), /^RUNOMINE_TOKEN=rm_live_NEWTOKEN123$/m);
  } finally {
    process.env = saved;
  }
});
