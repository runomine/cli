// runomine: the command line. See README.md.

import { readFileSync } from 'node:fs';
import { parseArgs } from './args.js';
import { makeContext } from './context.js';
import { login, logout, whoami } from './commands/auth.js';
import { init } from './commands/init.js';
import { integrations, invite, marker } from './commands/manage.js';
import { mcp } from './commands/mcp.js';
import { sites } from './commands/sites.js';
import { events, stats } from './commands/stats.js';
import { c, out } from './ui.js';

const HELP = `${c.bold('runomine')}: cookieless analytics that counts money, from the terminal.

${c.bold('Getting started')}
  runomine login                     Log in through the browser (no key to copy)
  runomine init                      Set this project up: site, token, library, code, first event
      --site <site>  --name <name>  --domain <domain>  --workspace <slug>  --framework <laravel|next|…>
      --from <path|git url|github|registry>  --yes  --rotate  --no-install  --no-wait  --wait <seconds>  --dir <path>
  runomine whoami | logout

${c.bold('Sites and numbers')}
  runomine sites ls | create <name> <domain> | open [site] | use <site> | rotate-token [site]
  runomine stats [--site] [--period today|24h|7d|30d|90d]
  runomine events tail [--site] [--name purchase]
  runomine marker add "Newsletter sent" [--at 2026-10-14T09:30] [--site]
  runomine invite <email> [--site <site>] [--role member|admin|viewer] [--workspace <slug>]

${c.bold('Revenue from your payment provider')}
  runomine integrations ls | connect stripe --key rk_live_… | backfill stripe | disconnect stripe

${c.bold('AI assistants')}
  runomine mcp setup [--print]       The runomine MCP server in Claude Code (or the config for others)

A site is its id (site_…), name, slug or domain. RUNOMINE_URL points at another server; RUNOMINE_PAT logs in
without the browser (CI); RUNOMINE_SITE picks the site.`;

const COMMANDS = { login, logout, whoami, init, sites, stats, events, marker, invite, integrations, mcp };

export async function main(argv, options = {}) {
  const args = parseArgs(argv);
  const [command] = args._;
  if (args.flags.version || command === 'version') {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    out(pkg.version);
    return 0;
  }
  if (!command || command === 'help' || args.flags.help) {
    out(HELP);
    return command || args.flags.help ? 0 : 1;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    out(HELP);
    throw new Error(`Unknown command "${command}".`);
  }
  return (await handler(makeContext(args, options))) ?? 0;
}
