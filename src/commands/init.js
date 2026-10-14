// `runomine init`: a project set up end to end. Detects the framework, picks or creates the site, writes the token
// to the env file, installs the library, makes the one code change that's safe to make, and waits for the first event.

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ApiError, listSites, matchSite } from '../api.js';
import { DEFAULT_URL } from '../config.js';
import { detect, GUIDES, LABELS } from '../detect.js';
import { isIgnored, readEnvValue, writeEnv } from '../env.js';
import { ensureClone, installPlan, resolveSource, run, shellLine } from '../install.js';
import { nextMiddleware, patchDjango } from '../patch.js';
import { ask, c, canPrompt, confirm, err, ok, out, select, sleep, spinner, step, warn } from '../ui.js';
import { login } from './auth.js';

const START = {
  laravel: 'php artisan serve',
  php: 'your PHP server',
  next: 'npm run dev',
  express: 'node app.js (or your start script)',
  node: 'your start script',
  django: 'python manage.py runserver',
  fastapi: 'uvicorn main:app --reload',
  python: 'your app',
  axum: 'cargo run',
  actix: 'cargo run',
  rust: 'cargo run',
  static: 'your site',
};

export async function init(ctx) {
  const { flags } = ctx.args;
  const yes = Boolean(flags.yes);
  const dir = resolve(typeof flags.dir === 'string' ? flags.dir : process.cwd());
  const project = detect(dir);
  if (typeof flags.framework === 'string') {
    if (!GUIDES[flags.framework]) throw new Error(`--framework is one of ${Object.keys(GUIDES).join(', ')}.`);
    Object.assign(project, { framework: flags.framework, guide: GUIDES[flags.framework], label: LABELS[flags.framework] });
  }
  out(`${c.bold('runomine init')} ${c.dim(dir)}`);
  step(`${project.label}${project.packageManager ? ` · ${project.packageManager}` : ''}${project.envFile ? ` · ${project.envFile}` : ''}${project.domain ? ` · ${project.domain}` : ''}`);

  if (!ctx.api.token) {
    if (!yes && !canPrompt()) throw new Error('Not logged in. Run `runomine login` first (or set RUNOMINE_PAT).');
    step('Not logged in yet: logging in through the browser.');
    await login(ctx);
  }

  // 1. The site.
  const { site, token: issued } = await chooseSite(ctx, project, { yes });
  ctx.save({ defaultSite: site.id });

  // 2. The token, in the env file (static sites need none: the script tag carries the public site id).
  if (project.framework !== 'static') {
    const token = issued ?? (await tokenForExisting(ctx, project, site, { yes }));
    if (token) writeToken(ctx, project, token, { yes });
  }

  // 3. The library.
  if (project.framework !== 'static') await install(ctx, project, { yes });

  // 4. The code.
  const guide = (await ctx.api.get(`/sites/${site.id}/install`, { framework: project.guide })).install[project.guide];
  codeChanges(project, guide, site);

  // 5. The first event.
  if (flags['no-wait']) {
    out();
    out(`Start ${START[project.framework]} and open a page; \`runomine events tail\` shows what arrives.`);
    return 0;
  }
  return waitForFirstEvent(ctx, project, site);
}

async function chooseSite(ctx, project, { yes }) {
  const { flags } = ctx.args;
  const sites = await listSites(ctx.api);
  if (typeof flags.site === 'string') {
    const { site, matches } = matchSite(sites, flags.site);
    if (!site) throw new Error(matches.length > 1 ? `"${flags.site}" matches several sites; use the id.` : `No site "${flags.site}" that you can see.`);
    step(`Site: ${c.bold(site.name)} ${c.dim(site.id)}`);
    return { site };
  }
  const wantedDomain = typeof flags.domain === 'string' ? flags.domain : project.domain;
  const domainMatch = wantedDomain ? matchSite(sites, wantedDomain).site : null;
  let choice = 'new';
  if (domainMatch && yes) choice = domainMatch;
  else if (sites.length && !yes) {
    const ordered = domainMatch ? [domainMatch, ...sites.filter((s) => s !== domainMatch)] : sites;
    choice = await select('Which site is this project?', [
      ...(domainMatch ? [] : [{ label: c.green('Create a new site'), value: 'new' }]),
      ...ordered.map((s) => ({ label: `${s.name} ${c.dim(`${s.domain ?? ''} · ${s.workspace.slug} · ${s.id}`)}`, value: s })),
      ...(domainMatch ? [{ label: c.green('Create a new site'), value: 'new' }] : []),
    ]);
  }
  if (choice !== 'new') {
    step(`Site: ${c.bold(choice.name)} ${c.dim(choice.id)}`);
    return { site: choice };
  }

  const name = typeof flags.name === 'string' ? flags.name : yes || !canPrompt() ? project.name : await ask('Site name', { default: project.name });
  let domain = wantedDomain;
  if (!domain) {
    if (yes || !canPrompt()) throw new Error('Which domain will this site run on? Pass --domain example.com.');
    domain = await ask('Its domain (where it runs in production, e.g. example.com)');
  }
  const created = await ctx.api.post('/sites', { name, domain, workspace: typeof flags.workspace === 'string' ? flags.workspace : undefined });
  ok(`Created ${c.bold(created.data.name)} ${c.dim(`${created.data.id} in ${created.data.workspace.slug}`)}`);
  return { site: created.data, token: created.token };
}

/** An existing site's token can't be read back: keep the one already in the env file, or rotate it (with care). */
async function tokenForExisting(ctx, project, site, { yes }) {
  const file = join(project.dir, project.envFile);
  if (readEnvValue(file, 'RUNOMINE_TOKEN')) {
    step(`${project.envFile} already has a RUNOMINE_TOKEN: kept.`);
    return null;
  }
  if (!site.permissions.manage) {
    warn(`You can see ${site.name} but not set it up, so runomine can't issue its token. Ask its admin for RUNOMINE_TOKEN.`);
    return null;
  }
  const live = Boolean(site.last_received_at);
  const question = live
    ? `${site.name} already receives data with its current token, which can't be read again. Rotate it? The app using it now stops sending until you update it.`
    : `${site.name}'s token can't be read again; issue a new one (nothing sends data with the old one yet)?`;
  const go = live ? (yes ? Boolean(ctx.args.flags.rotate) : await confirm(question, { default: false })) : await confirm(question, { default: true, yes });
  if (!go) {
    warn(`No token written. Put the app's RUNOMINE_TOKEN in ${project.envFile} yourself${live && yes ? ' (or pass --rotate)' : ''}.`);
    return null;
  }
  const { token } = await ctx.api.post(`/sites/${site.id}/token`);
  ok(`New token issued for ${site.name}.`);
  return token;
}

function writeToken(ctx, project, token, { yes }) {
  const file = join(project.dir, project.envFile);
  const values = { RUNOMINE_TOKEN: token };
  if (ctx.url !== DEFAULT_URL) values.RUNOMINE_URL = ctx.url;
  const current = readEnvValue(file, 'RUNOMINE_TOKEN');
  let overwrite = false;
  if (current && current !== token) {
    if (yes || !canPrompt()) {
      warn(`${project.envFile} has another RUNOMINE_TOKEN; left as it is. The new one (shown once): ${token}`);
      delete values.RUNOMINE_TOKEN;
    } else {
      overwrite = true;
    }
  }
  const result = writeEnv(file, values, { overwrite });
  for (const [key, what] of Object.entries(result)) ok(`${key} ${what} in ${project.envFile}`);
  if (!isIgnored(project.dir, project.envFile)) warn(`${project.envFile} isn't in .gitignore: keep the token out of git.`);
  const example = join(project.dir, '.env.example');
  if (project.envFile === '.env' && existsSync(example) && !readEnvValue(example, 'RUNOMINE_TOKEN') && !/^RUNOMINE_TOKEN=/m.test(readFileSync(example, 'utf8'))) {
    writeEnv(example, { RUNOMINE_TOKEN: '' });
    ok('RUNOMINE_TOKEN= added to .env.example');
  }
}

async function install(ctx, project, { yes }) {
  const { flags } = ctx.args;
  let source;
  try {
    source = resolveSource(typeof flags.from === 'string' ? flags.from : undefined);
  } catch (e) {
    throw new Error(e.message);
  }
  let plan = installPlan(project, source);
  const label = { path: `from ${source.root}`, git: `from ${source.url}`, public: 'from github.com/runomine' }[source.kind] ?? 'from the registry';
  step(`Installing the library ${c.dim(label)}`);
  const manual = flags['no-install'] || flags['dry-run'];
  if (manual) {
    if (plan.clone) out(`  ${c.dim('$')} git clone --depth 1 ${plan.clone.url} ${plan.clone.dir}`);
    for (const s of plan.steps) out(s.cmd ? `  ${c.dim('$')} ${shellLine(s.cmd)}` : s.append ? `  add to ${s.append.file}: ${s.append.line}` : `  ${s.note}`);
    return;
  }
  try {
    if (plan.clone) {
      await ensureClone(plan.clone);
      plan = installPlan(project, source);
    }
    for (const s of plan.steps) {
      if (s.note) {
        warn(s.note);
        continue;
      }
      if (s.append) {
        const text = readFileSync(s.append.file, 'utf8');
        if (!/^runomine\b/m.test(text) && !text.includes(s.append.line)) appendFileSync(s.append.file, `${text.endsWith('\n') || !text ? '' : '\n'}${s.append.line}\n`);
        ok(`${s.append.line} in requirements.txt`);
        continue;
      }
      if (s.mkdir) mkdirSync(s.mkdir, { recursive: true });
      out(`  ${c.dim('$')} ${shellLine(s.cmd)}`);
      await run(s.cmd, { cwd: project.dir });
    }
    ok('Library installed.');
  } catch (e) {
    err(`${c.red('✗')} ${e.message}`);
    warn('Install it by hand, then run `runomine init` again (it keeps what is done):');
    for (const s of plan.steps) if (s.cmd) out(`  ${shellLine(s.cmd)}`);
    if (!yes && canPrompt() && !(await confirm('Continue anyway?', { default: true }))) throw new Error('Stopped.');
  }
}

function printSteps(steps) {
  for (const s of steps) {
    out(`  ${c.dim(`# ${s.caption}`)}`);
    for (const line of s.code.split('\n')) out(`  ${line}`);
  }
}

function codeChanges(project, guide, site) {
  const code = guide.steps.slice(2);
  switch (project.framework) {
    case 'laravel':
      ok('Laravel: nothing to change, the package adds its page view middleware to the web group by itself.');
      break;
    case 'next': {
      const result = nextMiddleware(project);
      if (result.created) ok(`Created ${result.file}: page views from every page request.`);
      else {
        warn(`${result.file} already exists: wrap it with withRunomine (left untouched):`);
        out("  import { withRunomine } from '@runomine/node/next';\n  export default withRunomine(yourMiddleware);");
      }
      out(c.dim('  Client-side navigations: add the script tag to app/layout (see the @runomine/node README, "Client-side navigations").'));
      break;
    }
    case 'django': {
      const result = patchDjango(project.dir);
      if (result.patched) ok(`Added RunomineMiddleware to MIDDLEWARE in ${result.file}.`);
      else if (result.already) ok(`${result.file} already has RunomineMiddleware.`);
      else {
        warn(`Add the middleware to settings.py by hand (${result.reason}):`);
        out(result.diff.replace(/^/gm, '  '));
      }
      break;
    }
    case 'static':
      step('Add this before </head> on every page:');
      printSteps(guide.steps);
      return;
    default:
      step(`Add runomine to your ${project.label} app:`);
      printSteps(code.slice(0, 1));
  }
  // The guide's steps after the install and env ones: the first is the code change above, except on Laravel.
  const more = project.framework === 'laravel' ? code : code.slice(1);
  if (more.length) {
    out(c.dim('Then, for business events and revenue:'));
    printSteps(more);
  }
  out(c.dim(`Revenue straight from your payment provider: runomine integrations connect stripe --key rk_live_… --site ${site.id}`));
}

async function waitForFirstEvent(ctx, project, site) {
  const seconds = Number(ctx.args.flags.wait) > 0 ? Number(ctx.args.flags.wait) : 300;
  out();
  const spin = spinner(`Waiting for the first event (up to ${seconds}s): start ${START[project.framework]} and open a page…`);
  const deadline = Date.now() + seconds * 1000;
  try {
    while (Date.now() < deadline) {
      try {
        const live = await ctx.api.get(`/sites/${site.id}/live`);
        const first = live.recent?.[live.recent.length - 1];
        if (live.last_pageview_at || live.recent?.length) {
          spin.stop();
          ok(`First data arrived: ${first ? `${first.kind} ${first.what}` : 'a page view'}. ${c.bold('runomine is set up.')}`);
          out(c.dim(`See it: ${ctx.url}/app · runomine stats · runomine events tail`));
          return 0;
        }
      } catch (e) {
        if (!(e instanceof ApiError) || e.status >= 500 || e.status === 0) {
          // A hiccup: keep waiting.
        } else throw e;
      }
      await sleep(3000);
    }
  } finally {
    spin.stop();
  }
  warn(`Nothing arrived in ${seconds}s. Is the app running with the new env? \`runomine events tail\` keeps watching.`);
  return 0;
}
