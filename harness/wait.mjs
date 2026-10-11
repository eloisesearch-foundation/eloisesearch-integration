#!/usr/bin/env node
// Wait until an engine is ready to serve requests, not only listening.
//
//   node harness/wait.mjs --engine opensearch [--url URL] [--timeout 180]

import { setTimeout as sleep } from 'node:timers/promises';
import { cli, fail } from './lib/args.mjs';
import { engineConfig } from './lib/engines.mjs';

const usage = 'usage: node harness/wait.mjs --engine <name> [--url URL] [--timeout seconds]';
const args = cli({
  engine: { type: 'string' },
  url: { type: 'string' },
  timeout: { type: 'string', default: '180' },
}, usage);
if (!args.engine) fail(usage);

const engine = engineConfig(args.engine, args.url);
const deadline = Date.now() + Number(args.timeout) * 1000;
let last = 'no answer';
while (Date.now() < deadline) {
  try {
    const response = await fetch(engine.url + engine.ready, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      console.log(`${engine.name} ready at ${engine.url}`);
      process.exit(0);
    }
    last = `HTTP ${response.status}`;
  } catch (error) {
    last = error.cause?.code ?? error.message;
  }
  await sleep(2000);
}
fail(`${engine.name} not ready at ${engine.url} after ${args.timeout}s (last: ${last})`);
