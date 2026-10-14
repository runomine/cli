// mcp setup: the MCP server in Claude Code (`claude mcp add`, with its own token), or the config for other clients.
// Running it again doesn't pile tokens up: Claude Code keeps a token that still works, and a new token replaces (the
// server revokes) the previous one of the same name, which is the client's and this machine's.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { Api, ApiError } from '../api.js';
import { c, confirm, ok, out, warn } from '../ui.js';
import { run, shellLine } from '../install.js';

const onPath = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;

export function mcpConfigs(url, token) {
  const endpoint = `${url}/mcp`;
  return {
    claudeCode: ['claude', 'mcp', 'add', '--transport', 'http', 'runomine', endpoint, '--header', `Authorization: Bearer ${token}`],
    cursor: { mcpServers: { runomine: { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } },
    claudeDesktop: { mcpServers: { runomine: { command: 'npx', args: ['-y', 'mcp-remote', endpoint, '--header', 'Authorization:Bearer ${RUNOMINE_PAT}'], env: { RUNOMINE_PAT: token } } } },
  };
}

/** The token's name: one per client and machine, so the next setup replaces it (the server allows 80 characters). */
export function tokenName(client, host = hostname()) {
  return `MCP${client ? ` (${client})` : ''} on ${host}`.slice(0, 80);
}

/** The runomine server in Claude Code's user config ($CLAUDE_CONFIG_DIR or ~, .claude.json): { url, token }, or null. */
export function claudeServer(env = process.env) {
  try {
    const server = JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR || env.HOME || homedir(), '.claude.json'), 'utf8'))?.mcpServers?.runomine;
    if (!server || typeof server !== 'object') return null;
    const header = Object.entries(server.headers ?? {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
    return { url: typeof server.url === 'string' ? server.url.replace(/\/+$/, '') : null, token: /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? null };
  } catch {
    return null;
  }
}

/** GET /me with that token: who it is, or null when it doesn't work (revoked, another server's, …). */
async function whoIs(ctx, token) {
  try {
    return await new Api({ url: ctx.url, token, fetch: ctx.api.fetch }).get('/me');
  } catch (e) {
    if (e instanceof ApiError) return null;
    throw e;
  }
}

export async function mcp(ctx) {
  const [, sub = 'setup'] = ctx.args._;
  if (sub !== 'setup') throw new Error('Usage: runomine mcp setup [--print] [--rotate] [--yes]');
  const { flags } = ctx.args;
  const tools = { onPath, run, ...ctx.tools };
  const endpoint = `${ctx.url}/mcp`;
  const claude = !flags.print && tools.onPath('claude');

  // Already there with a token that works: nothing to do (no new token, no prompt).
  const existing = claude ? claudeServer(ctx.env) : null;
  const working = existing?.url === endpoint && existing.token ? await whoIs(ctx, existing.token) : null;
  if (working && !flags.rotate) {
    ok(`Claude Code already has the runomine MCP server with a working token ("${working.token.name}"). Nothing changed; \`--rotate\` gives it a new one.`);
    return 0;
  }
  const question = existing
    ? `Replace the runomine MCP server in Claude Code (${existing.url ?? 'no URL'}) with ${endpoint} and a new token of its own?`
    : 'Add the runomine MCP server to Claude Code (`claude mcp add`, user scope) with a token of its own?';
  if (claude && !(await confirm(question, { default: true, yes: Boolean(flags.yes) }))) {
    return out('Nothing changed.'), 1;
  }

  // A token for the MCP client alone, so it can be revoked without logging the CLI out; it replaces the one an
  // earlier setup made for the same client on this machine.
  const name = tokenName(claude ? 'Claude Code' : null);
  const made = await ctx.api.post('/tokens', { name, replace: true });
  const replaced = made.replaced ? ` It replaces ${made.replaced === 1 ? 'the previous token' : `${made.replaced} previous tokens`} of that name, now revoked.` : '';
  const configs = mcpConfigs(ctx.url, made.token);
  if (claude) {
    const cmd = [...configs.claudeCode.slice(0, 3), '--scope', 'user', ...configs.claudeCode.slice(3)];
    try {
      // `claude mcp add` refuses a name that's already there.
      if (existing) await tools.run(['claude', 'mcp', 'remove', 'runomine', '--scope', 'user'], { quiet: true }).catch(() => {});
      await tools.run(cmd);
      ok(`Claude Code has the runomine MCP server (token "${made.name}"; revoke it in ${ctx.url}/app/tokens).${replaced} Try: "How did my sites do this week?"`);
      if (working && working.token.name !== made.name) {
        out(c.dim(`The token it had ("${working.token.name}") still works: revoke it in ${ctx.url}/app/tokens if nothing else uses it.`));
      }
      return 0;
    } catch (e) {
      warn(`claude mcp add failed (${e.message}). Add it yourself:`);
    }
  }
  out(c.bold('Claude Code'));
  out(`  ${shellLine(configs.claudeCode)}`);
  out(c.bold('Cursor (~/.cursor/mcp.json)'));
  out(JSON.stringify(configs.cursor, null, 2).replace(/^/gm, '  '));
  out(c.bold('Claude Desktop (claude_desktop_config.json)'));
  out(JSON.stringify(configs.claudeDesktop, null, 2).replace(/^/gm, '  '));
  out(c.dim(`Token "${made.name}" shown only now; revoke it in ${ctx.url}/app/tokens.`));
  if (made.replaced) warn(`${replaced.trim()} Update any client still using it.`);
  return 0;
}
