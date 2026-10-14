// stats [--site] [--period 7d]: the key numbers against the period before, with sparklines.
// events tail [--site] [--name]: new events as they arrive.

import { resolveSite } from '../context.js';
import { c, eur, num, out, pct, sleep, sparkline, table } from '../ui.js';

const PERIODS = ['today', '24h', '7d', '30d', '90d'];

function change(delta) {
  if (!delta) return '';
  if (delta.dir === 'new') return c.green('new');
  if (delta.dir === 'flat') return c.dim('=');
  return delta.dir === 'up' ? c.green(`▲ ${delta.label}`) : c.red(`▼ ${delta.label}`);
}

export async function stats(ctx) {
  const { flags } = ctx.args;
  const period = typeof flags.period === 'string' ? flags.period : '7d';
  if (!PERIODS.includes(period)) throw new Error(`--period is one of ${PERIODS.join(', ')}.`);
  const site = await resolveSite(ctx);
  const [summary, series] = await Promise.all([
    ctx.api.get(`/sites/${site.id}/stats`, { period }),
    ctx.api.get(`/sites/${site.id}/timeseries`, { period }),
  ]);
  if (flags.json) return out(JSON.stringify({ summary, series }, null, 2)), 0;
  const cur = summary.current;
  const prev = summary.previous ?? {};
  const d = summary.change ?? {};
  const points = series.points;
  const spark = (key) => c.cyan(sparkline(points.map((p) => p[key])));
  out(`${c.bold(site.name)} ${c.dim(`· ${summary.period.label} · vs ${summary.period.previous.label}`)}`);
  out(table([
    ['Visitors', num(cur.visitors), change(d.visitors), c.dim(num(prev.visitors)), spark('visitors')],
    ['Page views', num(cur.pageviews), change(d.pageviews), c.dim(num(prev.pageviews)), spark('pageviews')],
    ['Events', num(cur.events), change(d.events), c.dim(num(prev.events)), spark('events')],
    ['Revenue', eur(cur.revenue_cents), change(d.revenue_cents), c.dim(eur(prev.revenue_cents)), spark('revenue_cents')],
    ['Orders', num(cur.orders), change(d.orders), c.dim(num(prev.orders)), ''],
    ['Conversion', pct(cur.conversion_rate), change(d.conversion_rate), c.dim(pct(prev.conversion_rate)), ''],
    ['Bounce rate', pct(cur.bounce_rate), change(d.bounce_rate), c.dim(pct(prev.bounce_rate)), ''],
  ], ['', 'NOW', 'CHANGE', 'BEFORE', points.length > 1 ? `${points[0].t} → ${points[points.length - 1].t}` : '']));
  out(c.dim(`On the site now: ${num(summary.on_site_now)}`));
  const [sources, pages] = await Promise.all([
    ctx.api.get(`/sites/${site.id}/top/sources`, { period, limit: 5 }),
    ctx.api.get(`/sites/${site.id}/top/pages`, { period, limit: 5 }),
  ]);
  if (sources.rows.length || pages.rows.length) {
    out();
    const rows = Array.from({ length: Math.max(sources.rows.length, pages.rows.length) }, (_, i) => [
      sources.rows[i]?.value ?? '', sources.rows[i] ? num(sources.rows[i].count) : '', pages.rows[i]?.value ?? '', pages.rows[i] ? num(pages.rows[i].count) : '',
    ]);
    out(table(rows, ['SOURCES', 'VISITORS', 'PAGES', 'VIEWS']));
  }
  return 0;
}

export async function events(ctx) {
  const [, sub = 'tail'] = ctx.args._;
  if (sub !== 'tail' && sub !== 'ls') throw new Error('Usage: runomine events tail [--site] [--name purchase]');
  const { flags } = ctx.args;
  const site = await resolveSite(ctx);
  const name = typeof flags.name === 'string' ? flags.name : undefined;
  const seen = new Set();
  const key = (e) => `${e.at}|${e.name}|${e.revenue_cents}|${e.source}|${JSON.stringify(e.props)}`;
  const line = (e) => `${c.dim(new Date(e.at).toLocaleTimeString())} ${c.bold(e.name)}${e.revenue_cents !== null ? ` ${c.green(eur(e.revenue_cents))}` : ''}${e.source ? c.dim(` · ${e.source}`) : ''}${Object.keys(e.props).length ? c.dim(` · ${Object.entries(e.props).map(([k, v]) => `${k}=${v}`).join(' ')}`) : ''}`;
  const first = await ctx.api.get(`/sites/${site.id}/events`, { name, limit: 10 });
  out(c.dim(`${site.name} · latest events${name ? ` "${name}"` : ''}${sub === 'tail' ? ' · watching (Ctrl-C to stop)' : ''}`));
  for (const e of [...first.events].reverse()) {
    seen.add(key(e));
    out(line(e));
  }
  if (sub === 'ls') return 0;
  const interval = Math.max(1, Number(flags.interval) || 3) * 1000;
  for (;;) {
    await sleep(interval);
    const { events: latest } = await ctx.api.get(`/sites/${site.id}/events`, { name, limit: 50 });
    for (const e of [...latest].reverse()) {
      if (seen.has(key(e))) continue;
      seen.add(key(e));
      out(line(e));
    }
  }
}
