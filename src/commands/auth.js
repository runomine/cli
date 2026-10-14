// login (the browser approves a code: nothing to copy), logout, whoami.

import { hostname } from 'node:os';
import { ApiError } from '../api.js';
import { DEFAULT_URL } from '../config.js';
import { c, err, ok, openBrowser, out, sleep, spinner } from '../ui.js';

export async function login(ctx) {
  const { flags } = ctx.args;
  const device = await ctx.api.startDevice(typeof flags.name === 'string' ? flags.name : `runomine CLI on ${hostname()}`);
  out(`Your code: ${c.bold(device.user_code)}`);
  out(`Approve it at ${c.cyan(device.verification_url_complete)}`);
  if (!flags['no-open'] && !(await openBrowser(device.verification_url_complete))) {
    err(c.dim('(Open that link in a browser where you are signed in to runomine.)'));
  }
  const spin = spinner('Waiting for you to approve it in the browser…');
  let interval = (device.interval ?? 5) * 1000;
  const deadline = Date.now() + (device.expires_in ?? 600) * 1000;
  try {
    while (Date.now() < deadline) {
      await sleep(interval);
      try {
        const { access_token: token } = await ctx.api.pollDevice(device.device_code);
        ctx.api.token = token;
        const me = await ctx.api.get('/me');
        const path = ctx.save({ url: ctx.url === DEFAULT_URL ? undefined : ctx.url, token, email: me.user.email });
        spin.stop();
        ok(`Logged in as ${c.bold(me.user.email)} ${c.dim(`(${ctx.url}; token saved in ${path})`)}`);
        return 0;
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        if (e.code === 'authorization_pending') continue;
        if (e.code === 'slow_down') {
          interval += 5000;
          continue;
        }
        throw new Error(e.code === 'access_denied' ? 'Denied in the browser. Nothing was saved.' : e.message);
      }
    }
    throw new Error('The code expired. Run `runomine login` again.');
  } finally {
    spin.stop();
  }
}

export async function logout(ctx) {
  if (!ctx.config.token) {
    out('Not logged in.');
    return 0;
  }
  try {
    await ctx.api.delete('/auth/token');
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) err(c.dim(`(Couldn't revoke the token on the server: ${e.message} Revoke it in API tokens.)`));
  }
  delete ctx.config.token;
  delete ctx.config.email;
  ctx.save({});
  ok('Logged out: the token is revoked and removed from this machine.');
  return 0;
}

export async function whoami(ctx) {
  const me = await ctx.api.get('/me');
  if (ctx.args.flags.json) {
    out(JSON.stringify(me, null, 2));
    return 0;
  }
  out(`${c.bold(me.user.name)} <${me.user.email}> ${c.dim(`on ${ctx.url}, token "${me.token.name}"`)}`);
  for (const w of me.workspaces) out(`  ${w.name} ${c.dim(`(${w.slug})`)} · ${w.role}`);
  return 0;
}
