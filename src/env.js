// Writing RUNOMINE_* into a dotenv file without touching anything else in it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const quote = (value) => (/^[A-Za-z0-9_./:@+-]*$/.test(value) ? value : JSON.stringify(value));

/**
 * Sets each key in $file (created if missing). A key already there keeps its value unless overwrite is on; a key
 * with an empty value counts as missing. Returns what happened per key: added, updated, kept.
 *
 * @returns {Record<string, 'added'|'updated'|'kept'>}
 */
export function writeEnv(file, values, { overwrite = false } = {}) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line));
    if (index === -1) {
      lines.push(`${key}=${quote(value)}`);
      result[key] = 'added';
      continue;
    }
    const current = lines[index].replace(/^[^=]*=\s*/, '').replace(/^(['"])(.*)\1$/, '$2').trim();
    if (current !== '' && !overwrite) {
      result[key] = 'kept';
      continue;
    }
    lines[index] = `${key}=${quote(value)}`;
    result[key] = current === '' ? 'added' : 'updated';
  }
  writeFileSync(file, `${lines.join('\n')}\n`);
  return result;
}

/** The value a dotenv file has for $key, or null. */
export function readEnvValue(file, key) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`));
    if (m) {
      const value = m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
      return value === '' ? null : value;
    }
  }
  return null;
}

/** Whether $dir's .gitignore keeps $file out of git (a plain line match: .env, .env*, .env.local, *.local). */
export function isIgnored(dir, file) {
  const path = join(dir, '.gitignore');
  if (!existsSync(path)) return false;
  const patterns = readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
  return patterns.some((p) => {
    const re = new RegExp(`^${p.replace(/^\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return re.test(file);
  });
}
