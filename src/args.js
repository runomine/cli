// A small argv parser: positionals, --flag value, --flag=value, boolean flags, repeated flags, -y / -h.

const BOOLEAN = new Set(['yes', 'json', 'help', 'version', 'rotate', 'no-wait', 'no-install', 'dry-run', 'compare', 'no-compare', 'print', 'no-open']);
const MULTI = new Set(['cred', 'step']);
const ALIASES = { y: 'yes', h: 'help', v: 'version', s: 'site', p: 'period' };

/** @returns {{ _: string[], flags: Record<string, any> }} */
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    let name;
    let value;
    if (arg.startsWith('--')) {
      [name, value] = arg.slice(2).split(/=(.*)/s, 2);
    } else if (/^-[a-zA-Z]$/.test(arg)) {
      name = ALIASES[arg[1]] ?? arg[1];
    } else {
      out._.push(arg);
      continue;
    }
    if (value === undefined) {
      if (BOOLEAN.has(name)) {
        value = true;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        value = argv[++i];
      } else {
        value = true;
      }
    } else if (BOOLEAN.has(name)) {
      value = !['false', '0', 'no'].includes(String(value).toLowerCase());
    }
    if (MULTI.has(name)) {
      (out.flags[name] ??= []).push(value);
    } else {
      out.flags[name] = value;
    }
  }
  return out;
}
