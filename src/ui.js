// Terminal output: colours (off with NO_COLOR or when not a TTY), a spinner, tables, sparklines, prompts.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const tty = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = { bold: paint('1'), dim: paint('2'), green: paint('32'), red: paint('31'), yellow: paint('33'), cyan: paint('36') };

export const out = (s = '') => process.stdout.write(`${s}\n`);
export const err = (s = '') => process.stderr.write(`${s}\n`);
export const ok = (s) => out(`${c.green('✓')} ${s}`);
export const warn = (s) => err(`${c.yellow('!')} ${s}`);
export const step = (s) => out(`${c.cyan('›')} ${s}`);

/** A spinner on stderr while a promise runs (a plain line when not a TTY). */
export function spinner(text) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let current = text;
  const live = Boolean(process.stderr.isTTY);
  const timer = live ? setInterval(() => process.stderr.write(`\r${c.cyan(frames[i++ % frames.length])} ${current}\x1b[K`), 90) : null;
  if (!live) err(`… ${text}`);
  return {
    update(t) {
      current = t;
    },
    stop(final) {
      if (timer) {
        clearInterval(timer);
        process.stderr.write('\r\x1b[K');
      }
      if (final) out(final);
    },
  };
}

const SPARKS = '▁▂▃▄▅▆▇█';

/** "▁▃▅█" for a series; flat at the floor when it's all zeros. */
export function sparkline(values) {
  const max = Math.max(0, ...values);
  if (!values.length) return '';
  return values.map((v) => (max ? SPARKS[Math.min(SPARKS.length - 1, Math.round((Math.max(0, v) / max) * (SPARKS.length - 1)))] : SPARKS[0])).join('');
}

const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

/** Rows as aligned columns; numbers right-aligned. */
export function table(rows, headers) {
  const all = headers ? [headers, ...rows] : rows;
  const widths = [];
  for (const row of all) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, [...strip(cell ?? '')].length)));
  const line = (row, head) =>
    row
      .map((cell, i) => {
        const text = String(cell ?? '');
        const pad = ' '.repeat(widths[i] - [...strip(text)].length);
        return /^[-+−€$]?[\d.,]+%?$/.test(strip(text)) && !head ? pad + text : text + pad;
      })
      .join('  ')
      .trimEnd();
  const lines = [];
  if (headers) lines.push(c.dim(line(headers, true)));
  for (const row of rows) lines.push(line(row));
  return lines.join('\n');
}

export const eur = (cents) => (cents === null || cents === undefined ? '–' : `${cents < 0 ? '−' : ''}€${(Math.abs(cents) / 100).toFixed(2)}`);
export const pct = (ratio) => (ratio === null || ratio === undefined ? '–' : `${(ratio * 100).toFixed(1)}%`);
export const num = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-US'));

export function canPrompt() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** One line of input. */
export function ask(question, { default: def } = {}) {
  if (!canPrompt()) return Promise.resolve(def ?? '');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(`${c.bold('?')} ${question}${def ? c.dim(` (${def})`) : ''} `, (answer) => {
      rl.close();
      resolve(answer.trim() || def || '');
    }),
  );
}

export async function confirm(question, { default: def = false, yes = false } = {}) {
  if (yes) return true;
  if (!canPrompt()) return def;
  const answer = (await ask(`${question} ${c.dim(def ? '[Y/n]' : '[y/N]')}`)).toLowerCase();
  return answer ? ['y', 'yes', 's', 'si', 'sí'].includes(answer) : def;
}

/** A numbered menu; returns the chosen item's value. */
export async function select(question, choices, { default: def = 0 } = {}) {
  if (!canPrompt()) return choices[def]?.value;
  out(`${c.bold('?')} ${question}`);
  choices.forEach((ch, i) => out(`  ${c.cyan(String(i + 1).padStart(2))}. ${ch.label}`));
  for (;;) {
    const answer = await ask('Number', { default: String(def + 1) });
    const n = Number.parseInt(answer, 10);
    if (n >= 1 && n <= choices.length) return choices[n - 1].value;
  }
}

/** Opens a URL in the browser (best effort); false when there's no opener. */
export function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => resolve(false));
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
