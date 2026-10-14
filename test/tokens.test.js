// Running `mcp setup` or `login` again doesn't pile personal access tokens up.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { main } from '../src/cli.js';
import { claudeServer, tokenName } from '../src/commands/mcp.js';
import { fakeServer, tempDir } from './helpers.js';

// The server's tokens: { id, name, token }. The CLI's own login is "cli".
let tokens;
let nextId;
let server;
const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer /, '');
const find = (req) => tokens.find((t) => t.token === bearer(req));
const unauthenticated = [401, { error: { code: 'unauthenticated', message: 'A valid personal access token is required.' } }];
const make = (name) => {
  const t = { id: nextId, name, token: `${nextId}|rm_pat_${nextId}` };
  nextId++;
  tokens.push(t);
  return t;
};

before(async () => {
  server = await fakeServer({
    'GET /api/v1/me': (req) => {
      const t = find(req);
      return t ? [200, { user: { id: 1, name: 'Olga', email: 'olga@example.com' }, token: { name: t.name }, workspaces: [] }] : unauthenticated;
    },
    'POST /api/v1/tokens': (req, body) => {
      const caller = find(req);
      if (!caller) return unauthenticated;
      const before = tokens.length;
      if (body.replace) tokens = tokens.filter((t) => t.name !== body.name || t === caller);
      const replaced = before - tokens.length;
      const t = make(body.name);
      return [201, { id: t.id, name: t.name, token: t.token, replaced }];
    },
    'DELETE /api/v1/auth/token': (req) => {
      const t = find(req);
      if (!t) return unauthenticated;
      tokens = tokens.filter((x) => x !== t);
      return [200, { revoked: true }];
    },
    'POST /api/v1/auth/device': () => [201, { device_code: 'dev', user_code: 'BCDF-GHJK', verification_url: 'http://x', verification_url_complete: 'http://x?code=BCDF-GHJK', expires_in: 600, interval: 0 }],
    'POST /api/v1/auth/token': () => [200, { access_token: make('runomine CLI on laptop').token, token_type: 'Bearer' }],
  });
});

after(() => server.close());

beforeEach(() => {
  tokens = [];
  nextId = 1;
});

/** A fake `claude` that keeps its user config in $CLAUDE_CONFIG_DIR/.claude.json like the real one. */
function fakeClaude(dir) {
  const file = join(dir, '.claude.json');
  const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
  const calls = [];
  return {
    calls,
    tools: {
      onPath: (cmd) => cmd === 'claude',
      run: async (cmd) => {
        calls.push(cmd.slice(0, 3).join(' '));
        const config = read();
        config.mcpServers ??= {};
        if (cmd[2] === 'remove') {
          if (!config.mcpServers.runomine) throw new Error('No MCP server named runomine');
          delete config.mcpServers.runomine;
        } else if (cmd[2] === 'add') {
          if (config.mcpServers.runomine) throw new Error('MCP server runomine already exists in user config');
          const header = cmd[cmd.indexOf('--header') + 1].split(': ');
          config.mcpServers.runomine = { type: 'http', url: cmd.at(-3), headers: { [header[0]]: header[1] } };
        }
        writeFileSync(file, JSON.stringify(config));
      },
    },
  };
}

function setup() {
  const dir = tempDir('runomine-claude-');
  const cli = make('cli');
  const env = { ...process.env, RUNOMINE_CONFIG: join(dir, 'config.json'), RUNOMINE_URL: server.url, RUNOMINE_PAT: cli.token, CLAUDE_CONFIG_DIR: dir };
  return { dir, env, claude: fakeClaude(dir) };
}

const names = () => tokens.map((t) => t.name).sort();
const NAME = tokenName('Claude Code');

test('token names are per client and machine, and fit the server', () => {
  assert.equal(tokenName('Claude Code', 'laptop'), 'MCP (Claude Code) on laptop');
  assert.equal(tokenName(null, 'laptop'), 'MCP on laptop');
  assert.equal(tokenName('Claude Code', 'h'.repeat(200)).length, 80);
  assert.equal(NAME, `MCP (Claude Code) on ${hostname()}`.slice(0, 80));
});

test('mcp setup again: keeps a working token, replaces a dead one, --rotate replaces the previous one', async () => {
  const { dir, env, claude } = setup();
  const options = { env, tools: claude.tools };

  assert.equal(await main(['mcp', 'setup', '--yes'], options), 0);
  assert.deepEqual(claude.calls, ['claude mcp add']);
  const posted = server.requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/tokens');
  assert.deepEqual(posted.at(-1).body, { name: NAME, replace: true });
  const first = claudeServer(env);
  assert.equal(first.url, `${server.url}/mcp`);
  assert.equal(first.token, tokens.at(-1).token);
  assert.deepEqual(names(), [NAME, 'cli']);

  // Again: the token in Claude Code still works, so nothing is made or changed.
  assert.equal(await main(['mcp', 'setup', '--yes'], options), 0);
  assert.deepEqual(claude.calls, ['claude mcp add']);
  assert.deepEqual(names(), [NAME, 'cli']);
  assert.deepEqual(claudeServer(env), first);

  // --rotate: a new one, the old one revoked by name, and Claude Code's entry replaced (add alone would refuse).
  assert.equal(await main(['mcp', 'setup', '--yes', '--rotate'], options), 0);
  assert.deepEqual(claude.calls, ['claude mcp add', 'claude mcp remove', 'claude mcp add']);
  assert.deepEqual(names(), [NAME, 'cli']);
  const second = claudeServer(env);
  assert.notEqual(second.token, first.token);
  assert.equal(tokens.find((t) => t.name === NAME).token, second.token);

  // Revoked elsewhere (on /app/tokens): the next setup makes a new one and fixes Claude Code.
  tokens = tokens.filter((t) => t.name !== NAME);
  assert.equal(await main(['mcp', 'setup', '--yes'], options), 0);
  assert.deepEqual(names(), [NAME, 'cli']);
  assert.equal(claudeServer(env).token, tokens.find((t) => t.name === NAME).token);

  // Pointing at another server: replaced too.
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { runomine: { type: 'http', url: 'https://elsewhere.example/mcp', headers: { Authorization: `Bearer ${tokens.find((t) => t.name === NAME).token}` } } } }));
  assert.equal(await main(['mcp', 'setup', '--yes'], options), 0);
  assert.equal(claudeServer(env).url, `${server.url}/mcp`);
  assert.deepEqual(names(), [NAME, 'cli']);
});

test('mcp setup --print: one token per machine, replaced each time', async () => {
  const { env, claude } = setup();
  for (let i = 0; i < 3; i++) assert.equal(await main(['mcp', 'setup', '--print'], { env, tools: claude.tools }), 0);
  assert.deepEqual(claude.calls, []);
  assert.deepEqual(names(), [tokenName(null), 'cli']);
});

test('the Claude Code config is read best effort', () => {
  const dir = tempDir('runomine-claude-');
  assert.equal(claudeServer({ CLAUDE_CONFIG_DIR: dir }), null);
  writeFileSync(join(dir, '.claude.json'), '{not json');
  assert.equal(claudeServer({ CLAUDE_CONFIG_DIR: dir }), null);
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { runomine: { type: 'http', url: 'http://x/mcp/', headers: { authorization: 'Bearer 3|rm_pat_x' } } } }));
  assert.deepEqual(claudeServer({ CLAUDE_CONFIG_DIR: dir }), { url: 'http://x/mcp', token: '3|rm_pat_x' });
});

test('login again revokes the previous login of this machine', async () => {
  const dir = tempDir();
  const env = { ...process.env, RUNOMINE_CONFIG: join(dir, 'config.json'), RUNOMINE_URL: server.url };
  delete env.RUNOMINE_PAT;
  assert.equal(await main(['login', '--no-open'], { env }), 0);
  const first = JSON.parse(readFileSync(env.RUNOMINE_CONFIG, 'utf8')).token;
  assert.equal(await main(['login', '--no-open'], { env }), 0);
  const second = JSON.parse(readFileSync(env.RUNOMINE_CONFIG, 'utf8')).token;
  assert.notEqual(first, second);
  assert.deepEqual(tokens.map((t) => t.token), [second]);
  const revoked = server.requests.filter((r) => r.method === 'DELETE' && r.path === '/api/v1/auth/token').at(-1);
  assert.equal(revoked.headers.authorization, `Bearer ${first}`);
});
