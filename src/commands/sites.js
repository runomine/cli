// sites ls | create | open | rotate-token | use

import { listSites } from '../api.js';
import { resolveSite } from '../context.js';
import { c, confirm, ok, openBrowser, out, table, warn } from '../ui.js';

const ago = (iso) => {
  if (!iso) return c.dim('no data yet');
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export async function sites(ctx) {
  const [, sub = 'ls', ...rest] = ctx.args._;
  const { flags } = ctx.args;
  switch (sub) {
    case 'ls':
    case 'list': {
      const list = await listSites(ctx.api);
      if (flags.json) return out(JSON.stringify(list, null, 2)), 0;
      if (!list.length) return out('No sites yet: `runomine init` in a project, or `runomine sites create <name> <domain>`.'), 0;
      out(table(list.map((s) => [
        (s.id === ctx.config.defaultSite ? c.green('● ') : '  ') + s.name, s.id, s.domain ?? '', s.workspace.slug, ago(s.last_received_at), s.permissions.manage ? 'manage' : 'view',
      ]), ['  NAME', 'ID', 'DOMAIN', 'WORKSPACE', 'LAST DATA', 'YOU']));
      return 0;
    }
    case 'create': {
      const [name, domain] = rest;
      if (!name || !domain) throw new Error('Usage: runomine sites create <name> <domain> [--workspace slug]');
      const created = await ctx.api.post('/sites', { name, domain, workspace: typeof flags.workspace === 'string' ? flags.workspace : undefined });
      ok(`Created ${c.bold(created.data.name)} ${c.dim(created.data.id)} in ${created.data.workspace.slug}`);
      out(`RUNOMINE_TOKEN=${created.token}`);
      out(c.dim('Shown only now: put it in the app\'s environment. Or run `runomine init --site '.concat(created.data.id, '` in the project.')));
      return 0;
    }
    case 'open': {
      const site = await resolveSite(ctx, { ref: rest[0] ?? flags.site });
      const url = `${ctx.url}/app/sites/${site.id}`;
      if (!(await openBrowser(url))) out(url);
      return 0;
    }
    case 'use': {
      const site = await resolveSite(ctx, { ref: rest[0] ?? flags.site });
      ctx.save({ defaultSite: site.id });
      ok(`Commands now default to ${c.bold(site.name)} ${c.dim(site.id)} (--site overrides it).`);
      return 0;
    }
    case 'rotate-token': {
      const site = await resolveSite(ctx, { ref: rest[0] ?? flags.site });
      warn(`The token ${site.name}'s app uses now stops working at once.`);
      if (!(await confirm('Rotate it?', { default: false, yes: Boolean(flags.yes) }))) return out('Not rotated.'), 1;
      const { token } = await ctx.api.post(`/sites/${site.id}/token`);
      ok(`New token for ${site.name} (shown only now):`);
      out(`RUNOMINE_TOKEN=${token}`);
      return 0;
    }
    default:
      throw new Error(`Unknown: sites ${sub}. Try: sites ls | create <name> <domain> | open | use <site> | rotate-token`);
  }
}
