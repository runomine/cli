// What kind of project a directory is: its framework, language, package manager, env file, name and domain.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const read = (dir, file) => {
  try {
    return readFileSync(join(dir, file), 'utf8');
  } catch {
    return null;
  }
};
const json = (dir, file) => {
  const text = read(dir, file);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};
const has = (dir, ...files) => files.some((f) => existsSync(join(dir, f)));

/** The install guide's tab (App\Support\InstallGuide) for each framework. */
export const GUIDES = {
  laravel: 'laravel',
  php: 'laravel',
  next: 'nextjs',
  express: 'express',
  node: 'express',
  django: 'django',
  fastapi: 'fastapi',
  python: 'fastapi',
  axum: 'rust',
  actix: 'rust',
  rust: 'rust',
  static: 'html',
};

export const LABELS = {
  laravel: 'Laravel',
  php: 'PHP',
  next: 'Next.js',
  express: 'Express',
  node: 'Node.js',
  django: 'Django',
  fastapi: 'FastAPI',
  python: 'Python',
  axum: 'Rust (axum)',
  actix: 'Rust (actix-web)',
  rust: 'Rust',
  static: 'static site (script tag)',
};

/** A hostname from a URL-ish value, unless it's local. */
export function hostOf(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(/^["']|["']$/g, '');
  let host;
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || !host.includes('.') || /(^|\.)(localhost|test|local|internal|example)$/.test(host) || /^[\d.]+$/.test(host)) return null;
  return host;
}

/** KEY=value pairs of a dotenv file. */
export function parseEnv(text) {
  const vars = {};
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

function nodePackageManager(dir, pkg) {
  const declared = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
  if (has(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(dir, 'yarn.lock')) return 'yarn';
  if (has(dir, 'bun.lockb', 'bun.lock')) return 'bun';
  if (has(dir, 'package-lock.json')) return 'npm';
  return ['pnpm', 'yarn', 'bun', 'npm'].includes(declared) ? declared : 'npm';
}

function pythonPackageManager(dir, pyproject) {
  if (has(dir, 'uv.lock')) return 'uv';
  if (has(dir, 'poetry.lock') || /\[tool\.poetry\]/.test(pyproject ?? '')) return 'poetry';
  if (/\[tool\.uv\]/.test(pyproject ?? '')) return 'uv';
  return 'pip';
}

/** dir → { framework, language, packageManager, envFile, name, domain, guide, label, nextMajor?, typescript?, srcDir? } */
export function detect(dir) {
  const project = { dir, framework: 'static', language: 'html', packageManager: null, envFile: null, name: basename(dir), domain: null };
  const envVars = { ...parseEnv(read(dir, '.env')), ...parseEnv(read(dir, '.env.local')), ...parseEnv(read(dir, '.env.production')) };

  const composer = json(dir, 'composer.json');
  const pkg = json(dir, 'package.json');
  const pyproject = read(dir, 'pyproject.toml');
  const requirements = [read(dir, 'requirements.txt'), read(dir, 'requirements.in'), read(dir, 'Pipfile')].filter(Boolean).join('\n');
  const cargo = read(dir, 'Cargo.toml');

  if (composer) {
    const deps = { ...composer.require, ...composer['require-dev'] };
    Object.assign(project, { language: 'php', packageManager: 'composer', envFile: '.env', framework: deps['laravel/framework'] ? 'laravel' : 'php' });
    if (composer.name && composer.name !== 'laravel/laravel') project.name = composer.name.split('/').pop();
    project.domain = hostOf(envVars.APP_URL);
  } else if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const framework = deps.next ? 'next' : deps.express ? 'express' : 'node';
    Object.assign(project, { language: 'node', packageManager: nodePackageManager(dir, pkg), framework, envFile: framework === 'next' ? '.env.local' : '.env' });
    if (pkg.name) project.name = pkg.name.replace(/^@[^/]+\//, '');
    project.domain = hostOf(pkg.homepage) ?? hostOf(envVars.NEXT_PUBLIC_SITE_URL) ?? hostOf(envVars.SITE_URL) ?? hostOf(envVars.APP_URL) ?? hostOf(envVars.NEXTAUTH_URL);
    if (framework === 'next') {
      const version = String(deps.next).match(/(\d+)/);
      project.nextMajor = version ? Number(version[1]) : null;
      project.typescript = has(dir, 'tsconfig.json');
      project.srcDir = has(dir, 'src/app', 'src/pages');
    }
  } else if (pyproject !== null || requirements || has(dir, 'manage.py', 'setup.py')) {
    const text = `${pyproject ?? ''}\n${requirements}`.toLowerCase();
    const framework = /(^|[^a-z_-])django([^a-z_-]|$)/m.test(text) || has(dir, 'manage.py') ? 'django' : /(^|[^a-z_-])fastapi([^a-z_-]|$)/m.test(text) ? 'fastapi' : 'python';
    Object.assign(project, { language: 'python', packageManager: pythonPackageManager(dir, pyproject), framework, envFile: '.env' });
    const name = pyproject?.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (name) project.name = name[1];
    project.domain = hostOf(envVars.SITE_URL) ?? hostOf(envVars.APP_URL) ?? hostOf((envVars.ALLOWED_HOSTS ?? '').split(',')[0]);
  } else if (cargo !== null) {
    const framework = /^\s*axum\s*=/m.test(cargo) ? 'axum' : /^\s*actix-web\s*=/m.test(cargo) ? 'actix' : 'rust';
    Object.assign(project, { language: 'rust', packageManager: 'cargo', framework, envFile: '.env' });
    const name = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (name) project.name = name[1];
    project.domain = hostOf(envVars.SITE_URL) ?? hostOf(envVars.APP_URL);
  } else {
    project.domain = hostOf(read(dir, 'CNAME')?.trim());
  }
  project.guide = GUIDES[project.framework];
  project.label = LABELS[project.framework];
  return project;
}
