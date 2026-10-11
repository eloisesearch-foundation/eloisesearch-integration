// Minimal `--name value` / `--flag` parsing for the harness commands.

import { parseArgs } from 'node:util';

export function cli(options, usage) {
  try {
    return parseArgs({ options, allowPositionals: false }).values;
  } catch (error) {
    console.error(`${error.message}\n\n${usage}`);
    process.exit(2);
  }
}

export function fail(message) {
  console.error(message);
  process.exit(1);
}
