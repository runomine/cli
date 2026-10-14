# runomine CLI

Set up [runomine](https://runomine.com) (cookieless analytics that counts money) in a project with one command, and
read your numbers from the terminal. Node 18+, no dependencies.

```sh
npx runomine login        # approve a code in the browser: nothing to copy
npx runomine init         # in your project: site, token, library, code, first event
```

## Install

Not on npm yet. From this repository:

```sh
npm install -g github:runomine/cli   # then: runomine …
# or without installing
npx github:runomine/cli init
```

Publishing later: `npm publish` from the repo root (the package is `runomine`, `bin/runomine.js`; `files` keeps only
`bin`, `src` and this README). Bump `version` in `package.json` first.

## `runomine login`

The device flow (RFC 8628): the CLI shows a code and opens `https://runomine.com/cli/authorize?code=…`; you approve it
signed in, and the CLI gets a personal access token of its own (named after the machine). It's saved in
`~/.config/runomine/config.json` (`$XDG_CONFIG_HOME`, or `$RUNOMINE_CONFIG`), readable only by you. `runomine logout`
revokes it on the server and removes it. Tokens are listed and revocable in the app, **API tokens**.

`--no-open` prints the link instead of opening the browser; `--name` names the device.

## `runomine init`

In a project directory:

1. **Detects** the framework and package manager: `composer.json` → Laravel (or plain PHP); `package.json` →
   Next.js / Express / other Node, with npm, pnpm, yarn or bun from the lockfile; `pyproject.toml` /
   `requirements.txt` → Django / FastAPI, with pip, poetry or uv; `Cargo.toml` → axum / actix-web / other Rust;
   anything else is a static site (the script tag). The domain comes from `APP_URL`, `homepage`, `SITE_URL`,
   `NEXT_PUBLIC_SITE_URL` or `CNAME` when it's a real one; otherwise it asks.
2. **Picks or creates the site**: a menu of your sites (the one matching the domain first), or a new one.
3. **Writes `RUNOMINE_TOKEN`** (and `RUNOMINE_URL`, only when not `https://runomine.com`) to `.env` (`.env.local` for
   Next.js), never touching other keys and never replacing a token that's there without asking. A site's token can't
   be read again, so for an existing site it keeps the one already in the file, or rotates it: freely when the site
   never got data, only with confirmation (or `--rotate`) when it did. Warns when the file isn't gitignored.
4. **Installs the library** with the project's package manager (see "Where the libraries come from").
5. **Code**, only where it's unambiguous: Laravel needs nothing (the package registers its middleware); Next.js gets
   `middleware.ts` (`proxy.ts` on Next 16+, `.js` without TypeScript, under `src/` with that layout) unless one exists;
   Django's `MIDDLEWARE` gets `runomine.django.RunomineMiddleware` after the auth middleware when it's one plain list
   in one settings file. Everything else (Express, FastAPI, axum, actix-web, an existing Next middleware, an unusual
   Django settings) is printed to paste.
6. **Waits for the first event** (polls the site's live numbers, 300 s by default): start the app and open a page.

Non-interactive: `runomine init --yes [--site <site> | --name <name> --domain <domain>] [--workspace <slug>]`.
Other flags: `--framework <laravel|next|express|django|fastapi|axum|actix|static|…>`, `--dir <path>`,
`--no-install` (print the install commands), `--no-wait`, `--wait <seconds>`, `--rotate`.

### Where the libraries come from (`--from`)

The libraries aren't on Packagist, npm, PyPI or crates.io yet, so by default `init` installs each one straight from
**its public GitHub repo**:

| Language | Repo |
|---|---|
| PHP | [runomine/runomine-php](https://github.com/runomine/runomine-php) |
| Node | [runomine/runomine-node](https://github.com/runomine/runomine-node) |
| Python | [runomine/runomine-python](https://github.com/runomine/runomine-python) |
| Rust | [runomine/runomine-rust](https://github.com/runomine/runomine-rust) |

| `--from` | |
|---|---|
| (nothing) | the public repos (or, when the CLI runs from a checkout of the runomine monorepo, its `sdks/`) |
| `github` | the public repos, always |
| `registry` | the published packages: use this once they're out (it will become the default) |
| `/path/to/runomine` | a checkout of the runomine monorepo (its root or its `sdks/`), for runomine's own development |
| `git@…/runomine.git`, `https://…/runomine.git` | the runomine monorepo's git URL (your git credentials must read it) |

How each package manager gets it:

| | github (default) | registry | from a path | from a monorepo git URL |
|---|---|---|---|---|
| composer | vcs repository `https://github.com/runomine/runomine-php` + `composer require runomine/runomine-php:dev-main` | `composer require runomine/runomine-php` | path repository (`symlink: false`) + `composer require runomine/runomine-php:*@dev` | cloned to `~/.cache/runomine/repo`, then as a path |
| npm, pnpm, yarn, bun | `add github:runomine/runomine-node` | `add @runomine/node` | `npm pack` into `vendor/`, then `add ./vendor/runomine-node-0.1.0.tgz` (commit it: CI installs it too) | same, from the clone |
| uv, poetry | `uv add 'runomine @ git+https://github.com/runomine/runomine-python.git'` / `poetry add git+https://…` | `add runomine` | `uv add <path>` / `poetry add <path>` | `…#subdirectory=sdks/python` |
| pip | `runomine @ git+https://github.com/runomine/runomine-python.git`, into `.venv`/`venv` when there is one, and a line in `requirements.txt` | `pip install runomine` | the path, the same way | `runomine @ git+…#subdirectory=sdks/python` |
| cargo | `cargo add runomine --git https://github.com/runomine/runomine-rust --features axum` | `cargo add runomine` | `cargo add runomine --path …` | `cargo add runomine --git …` |

A path (composer, pip, uv, poetry, cargo) is only right on your machine: before deploying, switch to the public repos
(`--from github`) or, once published, the registry. The vendored npm tarball works everywhere.

## Everything else

```sh
runomine whoami | logout
runomine sites ls | create <name> <domain> | open [site] | use <site> | rotate-token [site]
runomine stats [--site <site>] [--period today|24h|7d|30d|90d] [--json]
runomine events tail [--site <site>] [--name purchase]     # events ls: once
runomine marker add "Newsletter sent" [--at 2026-10-14T09:30] [--site <site>]
runomine invite <email> [--site <site>] [--role member|admin|viewer] [--workspace <slug>]
runomine integrations ls | connect stripe --key rk_live_… | backfill stripe | disconnect stripe [--site <site>]
runomine mcp setup [--print] [--yes]
```

A site is its id (`site_…`), name, slug or domain; without `--site`, the one `init` or `sites use` picked, or your
only one. `integrations connect` takes `--key` (the provider's main secret: Stripe `secret_key`, Paddle and Lemon
Squeezy `api_key`, Shopify `access_token`, PayPal `client_secret`), `--secret` (a webhook signing secret) and
`--cred name=value` for the rest (`--cred shop=acme.myshopify.com`, `--cred client_id=…`).

`runomine mcp setup` makes a token just for the MCP client and, when `claude` is on the PATH, runs
`claude mcp add --transport http --scope user runomine https://runomine.com/mcp --header "Authorization: Bearer …"`
after asking. `--print` shows the Claude Code, Cursor and Claude Desktop configs instead.

## Environment

| | |
|---|---|
| `RUNOMINE_URL` | another server (`http://localhost:8010` for local development). `login` remembers it. |
| `RUNOMINE_PAT` | a personal access token, instead of `login` (CI) |
| `RUNOMINE_SITE` | the site, instead of `--site` |
| `RUNOMINE_CONFIG` | where the config file is |
| `NO_COLOR` | no colours |

## Development

```sh
npm test     # node --test: detection on test/fixtures, env writing, install plans, patches, the API client and login/init against a fake server
```

## License

MIT. See [LICENSE](LICENSE).
