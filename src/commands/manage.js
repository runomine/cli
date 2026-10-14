// marker add, invite, integrations ls | connect | backfill | disconnect.

import { resolveSite } from '../context.js';
import { c, confirm, ok, out, sleep, spinner, table, warn } from '../ui.js';

export async function marker(ctx) {
  const [, sub, ...rest] = ctx.args._;
  if (sub !== 'add' || !rest.length) throw new Error('Usage: runomine marker add "what happened" [--at 2026-10-14T09:30] [--site]');
  const site = await resolveSite(ctx);
  const { data } = await ctx.api.post(`/sites/${site.id}/markers`, { label: rest.join(' '), at: typeof ctx.args.flags.at === 'string' ? ctx.args.flags.at : undefined });
  ok(`Marker "${data.label}" on ${site.name} at ${new Date(data.at).toLocaleString()}`);
  return 0;
}

export async function invite(ctx) {
  const [, email] = ctx.args._;
  const { flags } = ctx.args;
  if (!email) throw new Error('Usage: runomine invite <email> [--site <site>] [--role member|admin|viewer] [--workspace slug]');
  let workspace = typeof flags.workspace === 'string' ? flags.workspace : null;
  let site = null;
  if (typeof flags.site === 'string') {
    site = await resolveSite(ctx);
    workspace = site.workspace.slug;
  }
  if (!workspace) {
    const me = await ctx.api.get('/me');
    const managed = me.workspaces.filter((w) => w.permissions.manage);
    if (me.workspaces.length === 1) workspace = me.workspaces[0].slug;
    else if (managed.length === 1) workspace = managed[0].slug;
    else throw new Error(`Which workspace? --workspace ${me.workspaces.map((w) => w.slug).join(' | ')} (or --site for one site).`);
  }
  const role = typeof flags.role === 'string' ? flags.role : undefined;
  const res = await ctx.api.post(`/workspaces/${workspace}/invitations`, { email, role, site: site?.id });
  if (res.granted) {
    ok(`${res.granted.user.name} was already in the workspace: now ${res.granted.role} of ${site.name}.`);
    return 0;
  }
  const inv = res.invitation;
  ok(`Invited ${inv.email} to ${inv.site ? inv.site.name : workspace} as ${inv.role}.${inv.emailed ? ' An email is on its way.' : ''}`);
  out(`Link (single use, until ${inv.expires_at.slice(0, 10)}): ${c.cyan(inv.link)}`);
  return 0;
}

/** --key/--secret/--cred name=value → the provider's credential fields. */
function credentials(provider, flags) {
  const creds = {};
  for (const pair of flags.cred ?? []) {
    const [k, ...v] = String(pair).split('=');
    creds[k] = v.join('=');
  }
  const keyField = { stripe: 'secret_key', paddle: 'api_key', lemonsqueezy: 'api_key', shopify: 'access_token', paypal: 'client_secret' }[provider];
  if (typeof flags.key === 'string' && keyField) creds[keyField] = flags.key;
  if (typeof flags.secret === 'string') creds.signing_secret = flags.secret;
  return creds;
}

export async function integrations(ctx) {
  const [, sub = 'ls', provider] = ctx.args._;
  const { flags } = ctx.args;
  const site = await resolveSite(ctx);
  switch (sub) {
    case 'ls':
    case 'status': {
      const res = await ctx.api.get(`/sites/${site.id}/integrations`);
      if (flags.json) return out(JSON.stringify(res, null, 2)), 0;
      out(c.bold(`${site.name} · payment providers`));
      out(table(res.data.map((i) => [
        i.name, i.status === 'connected' ? c.green(i.status) : i.status === 'not_connected' ? c.dim('not connected') : c.yellow(i.status),
        i.last_event_at ? `last webhook ${i.last_event_at.slice(0, 16).replace('T', ' ')}` : '',
        i.backfill ? (i.backfill.running ? `importing (${i.backfill.imported})` : i.backfill.error ? c.red(i.backfill.error) : `history: ${i.backfill.imported} imported`) : '',
      ]), ['PROVIDER', 'STATUS', 'WEBHOOKS', 'HISTORY']));
      if (res.double_counted_sales) warn(`${res.double_counted_sales} sales were also sent with revenue by the app: counted twice.`);
      return 0;
    }
    case 'connect': {
      if (!provider) throw new Error('Usage: runomine integrations connect <stripe|paddle|lemonsqueezy|shopify|paypal> --key … [--cred name=value]');
      const res = await ctx.api.post(`/sites/${site.id}/integrations/${provider}`, { credentials: credentials(provider, flags) });
      ok(res.message);
      if (res.webhook_events) out(`Webhook URL: ${res.data.webhook_url}\nEvents: ${res.webhook_events.join(', ')}`);
      if (res.data.can_backfill && res.data.status === 'connected') out(c.dim(`Import the history: runomine integrations backfill ${provider}`));
      return 0;
    }
    case 'backfill': {
      if (!provider) throw new Error('Usage: runomine integrations backfill <provider>');
      const spin = spinner(`Importing ${provider}'s history…`);
      try {
        for (;;) {
          const res = await ctx.api.post(`/sites/${site.id}/integrations/${provider}/backfill`);
          const b = res.backfill ?? {};
          if (b.error) throw new Error(b.error);
          if (!res.continue) {
            spin.stop();
            ok(`Imported ${b.imported} payments from ${provider}.`);
            return 0;
          }
          spin.update(`Importing ${provider}'s history… ${b.imported} so far`);
          await sleep(500);
        }
      } finally {
        spin.stop();
      }
    }
    case 'disconnect': {
      if (!provider) throw new Error('Usage: runomine integrations disconnect <provider>');
      if (!(await confirm(`Disconnect ${provider} from ${site.name}? New payments stop arriving.`, { yes: Boolean(flags.yes) }))) return out('Left connected.'), 1;
      ok((await ctx.api.delete(`/sites/${site.id}/integrations/${provider}`)).message);
      return 0;
    }
    default:
      throw new Error(`Unknown: integrations ${sub}. Try: ls | connect <provider> | backfill <provider> | disconnect <provider>`);
  }
}
