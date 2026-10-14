// Installing the runomine library with the project's own package manager, from wherever the libraries are: the
// registries once they're published, and until then each library's public GitHub repo, or (--from) a checkout of
// the runomine repo or its git URL.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Each library's public repo: installed straight from git, no clone. */
export const PUBLIC_REPOS = {
  php: 'https://github.com/runomine/runomine-php',
  node: 'https://github.com/runomine/runomine-node',
  python: 'https://github.com/runomine/runomine-python.git',
  rust: 'https://github.com/runomine/runomine-rust',
};

/** The package each language installs (docs/contract.md, "Libraries"). */
export const PACKAGES = { php: 'runomine/runomine-php', node: '@runomine/node', python: 'runomine', rust: 'runomine' };

const SDK_DIRS = { php: 'php', node: 'node', python: 'python', rust: 'rust' };
const isGit = (from) => /^(git@|git\+|ssh:\/\/|git:\/\/|github:)/.test(from) || /^https?:\/\/.+\.git(#.*)?$/.test(from);

/**
 * Where the libraries come from.
 *  - "registry": Packagist, npm, PyPI, crates.io (once they're published).
 *  - "github": each library's public repo (PUBLIC_REPOS).
 *  - a git URL: the runomine repo itself (needs credentials that can read it).
 *  - a path: a checkout of the repo (its root or its sdks/ directory).
 *  - nothing: the checkout this CLI runs from, if it's inside one; else the public repos.
 */
export function resolveSource(from, { cliDir = dirname(dirname(fileURLToPath(import.meta.url))) } = {}) {
  if (from === 'registry') return { kind: 'registry' };
  if (from === 'github') return { kind: 'public' };
  if (!from || from === true) {
    const root = resolve(cliDir, '..');
    return existsSync(join(root, 'sdks', 'node', 'package.json')) ? { kind: 'path', root } : { kind: 'public' };
  }
  if (isGit(from)) return { kind: 'git', url: from.replace(/^git\+(?=https?:|ssh:)/, '') };
  const path = resolve(from);
  if (existsSync(join(path, 'sdks'))) return { kind: 'path', root: path };
  if (basename(path) === 'sdks') return { kind: 'path', root: dirname(path) };
  if (existsSync(join(path, 'node', 'package.json')) || existsSync(join(path, 'php', 'composer.json'))) return { kind: 'path', root: dirname(path) };
  throw new Error(`--from ${from}: not a checkout of the runomine repo (no sdks/ in it), a git URL, "github" or "registry".`);
}

/** Where a git source is cloned to, for package managers that need files (composer, npm). */
export function cacheDir(env = process.env) {
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'runomine', 'repo');
}

const pyGit = (url) => `runomine @ git+${url}#subdirectory=sdks/python`;
const rustFeature = { axum: 'axum', actix: 'actix-web' };

/**
 * What to run to install the library: a list of steps, each a command ([program, ...args]) with a label, or a note
 * for the person when there's nothing safe to run. $project comes from detect().
 *
 * @returns {{ steps: Array<{ label: string, cmd?: string[], note?: string, append?: { file: string, line: string } }>, sdk?: string, clone?: { url: string, dir: string } }}
 */
export function installPlan(project, source, { env = process.env } = {}) {
  const { language, packageManager: pm, framework, dir } = project;
  if (language === 'html') return { steps: [] };
  let clone;
  let sdk;
  if (source.kind === 'path') sdk = join(source.root, 'sdks', SDK_DIRS[language]);
  if (source.kind === 'git' && (language === 'php' || language === 'node')) {
    clone = { url: source.url, dir: cacheDir(env) };
    sdk = join(clone.dir, 'sdks', SDK_DIRS[language]);
  }
  const steps = [];

  if (language === 'php') {
    if (source.kind === 'registry') {
      steps.push({ label: 'composer require', cmd: ['composer', 'require', PACKAGES.php] });
    } else if (source.kind === 'public') {
      const repo = JSON.stringify({ type: 'vcs', url: PUBLIC_REPOS.php });
      steps.push({ label: 'composer: add the GitHub repository', cmd: ['composer', 'config', 'repositories.runomine', repo] });
      steps.push({ label: 'composer require', cmd: ['composer', 'require', `${PACKAGES.php}:dev-main`] });
    } else {
      const repo = JSON.stringify({ type: 'path', url: sdk, options: { symlink: false } });
      steps.push({ label: 'composer: add the local package repository', cmd: ['composer', 'config', 'repositories.runomine', repo] });
      steps.push({ label: 'composer require', cmd: ['composer', 'require', `${PACKAGES.php}:*@dev`] });
    }
  }

  if (language === 'node') {
    const add = { npm: ['npm', 'install'], pnpm: ['pnpm', 'add'], yarn: ['yarn', 'add'], bun: ['bun', 'add'] }[pm] ?? ['npm', 'install'];
    if (source.kind === 'registry') {
      steps.push({ label: `${pm} add ${PACKAGES.node}`, cmd: [...add, PACKAGES.node] });
    } else if (source.kind === 'public') {
      // dist/ is committed, so a git install needs no build.
      const spec = `github:${PUBLIC_REPOS.node.replace('https://github.com/', '')}`;
      steps.push({ label: `${pm} add ${spec}`, cmd: [...add, spec] });
    } else {
      // The packed tarball, vendored in the project so CI and deploys install it too (sdks/node/README.md).
      // Not cloned yet (a git source): the name it will have; init plans again once it's there.
      const manifest = join(sdk, 'package.json');
      const pkg = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : { name: PACKAGES.node, version: '0.1.0' };
      const tarball = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
      steps.push({ label: `npm pack ${pkg.name} into vendor/`, cmd: ['npm', 'pack', sdk, '--pack-destination', join(dir, 'vendor'), '--silent'], mkdir: join(dir, 'vendor') });
      steps.push({ label: `${pm} add ./vendor/${tarball}`, cmd: [...add, `${pm === 'yarn' ? 'file:' : ''}./vendor/${tarball}`] });
    }
  }

  if (language === 'python') {
    const spec = { registry: PACKAGES.python, public: `runomine @ git+${PUBLIC_REPOS.python}`, git: pyGit(source.url) }[source.kind] ?? sdk;
    const poetrySpec = { public: `git+${PUBLIC_REPOS.python}`, git: `git+${source.url}#subdirectory=sdks/python` }[source.kind] ?? spec;
    if (pm === 'uv') steps.push({ label: 'uv add', cmd: ['uv', 'add', spec] });
    else if (pm === 'poetry') steps.push({ label: 'poetry add', cmd: ['poetry', 'add', poetrySpec] });
    else {
      const venv = ['.venv', 'venv', 'env'].map((v) => join(dir, v, 'bin', 'python')).find((p) => existsSync(p));
      if (existsSync(join(dir, 'requirements.txt'))) steps.push({ label: 'requirements.txt', append: { file: join(dir, 'requirements.txt'), line: spec } });
      if (venv) steps.push({ label: `pip install (${relative(dir, venv)})`, cmd: [venv, '-m', 'pip', 'install', spec] });
      else steps.push({ label: 'pip install', note: `No virtualenv found (.venv, venv). In yours, run: pip install ${JSON.stringify(spec)}` });
    }
  }

  if (language === 'rust') {
    const feature = rustFeature[framework];
    const args = ['cargo', 'add', 'runomine'];
    if (source.kind === 'path') args.push('--path', sdk);
    if (source.kind === 'git') args.push('--git', source.url);
    if (source.kind === 'public') args.push('--git', PUBLIC_REPOS.rust);
    if (feature) args.push('--features', feature);
    steps.push({ label: 'cargo add runomine', cmd: args });
  }

  return { steps, sdk, clone };
}

/** Runs a command in $cwd with the output shown; rejects when it fails. */
export function run(cmd, { cwd, quiet = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), { cwd, stdio: quiet ? 'ignore' : 'inherit', env: process.env });
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? `${cmd[0]} isn't installed (or not on PATH).` : e.message)));
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd.join(' ')} exited with ${code}.`))));
  });
}

/** Clones (or updates) a git source into the cache. */
export async function ensureClone({ url, dir }) {
  if (existsSync(join(dir, '.git'))) {
    await run(['git', '-C', dir, 'pull', '--ff-only', '--quiet']);
  } else {
    mkdirSync(dirname(dir), { recursive: true });
    await run(['git', 'clone', '--depth', '1', '--quiet', url, dir]);
  }
}

/** A command as one copy-pasteable line. */
export function shellLine(cmd) {
  return cmd.map((a) => (/^[A-Za-z0-9_./:@=+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}

