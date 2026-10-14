#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(`runomine: ${err?.message ?? err}\n`);
    if (process.env.RUNOMINE_DEBUG) process.stderr.write(`${err?.stack ?? ''}\n`);
    process.exit(1);
  },
);
