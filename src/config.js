// Where the CLI keeps its login: ~/.config/runomine/config.json (or $XDG_CONFIG_HOME, or $RUNOMINE_CONFIG), 0600.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_URL = 'https://runomine.com';

export function configPath(env = process.env) {
  if (env.RUNOMINE_CONFIG) return env.RUNOMINE_CONFIG;
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'runomine', 'config.json');
}

export function loadConfig(env = process.env) {
  const path = configPath(env);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/** Writes the whole config, readable by its owner only. */
export function saveConfig(config, env = process.env) {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function clearConfig(env = process.env) {
  rmSync(configPath(env), { force: true });
}

/** The server: $RUNOMINE_URL, else --url at login (kept in the config), else runomine.com. No trailing slash. */
export function baseUrl(config, env = process.env) {
  return (env.RUNOMINE_URL || config.url || DEFAULT_URL).replace(/\/+$/, '');
}

/** The personal access token: $RUNOMINE_PAT (CI), else the one `runomine login` saved. */
export function accessToken(config, env = process.env) {
  return env.RUNOMINE_PAT || config.token || null;
}
