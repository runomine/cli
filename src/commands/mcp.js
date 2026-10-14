// mcp setup: the MCP server in Claude Code (`claude mcp add`, with its own token), or the config for other clients.

import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
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

export async function mcp(ctx) {
  const [, sub = 'setup'] = ctx.args._;
  if (sub !== 'setup') throw new Error('Usage: runomine mcp setup [--print] [--yes]');
  const { flags } = ctx.args;
  const claude = !flags.print && onPath('claude');
  if (claude && !(await confirm('Add the runomine MCP server to Claude Code (`claude mcp add`, user scope) with a token of its own?', { default: true, yes: Boolean(flags.yes) }))) {
    return out('Nothing changed.'), 1;
  }
  // A token for the MCP client alone, so it can be revoked without logging the CLI out.
  const made = await ctx.api.post('/tokens', { name: `MCP${claude ? ' (Claude Code)' : ''} on ${hostname()}` });
  const configs = mcpConfigs(ctx.url, made.token);
  if (claude) {
    const cmd = [...configs.claudeCode.slice(0, 3), '--scope', 'user', ...configs.claudeCode.slice(3)];
    try {
      await run(cmd);
      ok(`Claude Code has the runomine MCP server (token "${made.name}"; revoke it in ${ctx.url}/app/tokens). Try: "How did my sites do this week?"`);
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
  return 0;
}
