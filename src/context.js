// What every command gets: the parsed arguments, the saved login, an API client, and the site it's about.

import { Api, listSites, matchSite } from './api.js';
import { accessToken, baseUrl, loadConfig, saveConfig } from './config.js';
import { canPrompt, select } from './ui.js';

export function makeContext(args, { env = process.env, fetch = globalThis.fetch, tools = null } = {}) {
  const config = loadConfig(env);
  const url = typeof args.flags.url === 'string' ? args.flags.url.replace(/\/+$/, '') : baseUrl(config, env);
  const ctx = {
    args,
    tools, // tests swap the external commands (e.g. `claude`) for fakes: { onPath, run }
    env,
    config,
    url,
    api: new Api({ url, token: accessToken(config, env), fetch }),
    save(changes) {
      Object.assign(ctx.config, changes);
      return saveConfig(ctx.config, env);
    },
  };
  return ctx;
}

/**
 * The site a command is about: --site, else $RUNOMINE_SITE, else the one `runomine init` / `sites use` picked, else
 * the only one the person sees; with several and a terminal, a menu. By id, slug, name or domain.
 */
export async function resolveSite(ctx, { ref = ctx.args.flags.site, prompt = true } = {}) {
  const sites = await listSites(ctx.api);
  if (!sites.length) throw new Error('You have no sites yet. Create one with `runomine init` or `runomine sites create <name> <domain>`.');
  const wanted = (typeof ref === 'string' && ref) || ctx.env.RUNOMINE_SITE || ctx.config.defaultSite;
  if (wanted) {
    const { site, matches } = matchSite(sites, wanted);
    if (site) return site;
    if (wanted === ctx.config.defaultSite && !ref) {
      // The saved one is gone (deleted, or access removed): fall through to choosing.
    } else {
      throw new Error(matches.length > 1
        ? `"${wanted}" matches several sites: ${matches.map((s) => `${s.name} (${s.id})`).join(', ')}. Use the id.`
        : `No site "${wanted}" that you can see. Yours: ${sites.map((s) => `${s.name} (${s.id})`).join(', ')}.`);
    }
  }
  if (sites.length === 1) return sites[0];
  if (prompt && canPrompt()) {
    return select('Which site?', sites.map((s) => ({ label: `${s.name} ${s.domain ? `(${s.domain})` : ''} ${s.id}`, value: s })));
  }
  throw new Error(`Which site? Pass --site: ${sites.map((s) => `${s.name} (${s.id})`).join(', ')}.`);
}
