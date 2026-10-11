#!/usr/bin/env node
// Run the contract cases against one engine and write reports/<engine>-<version>.json.
//
//   node harness/run.mjs --engine elasticsearch [--url URL] [--only id,id] [--out reports]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cli, fail } from './lib/args.mjs';
import { loadDivergences, loadGroups, validateGroups } from './lib/cases.mjs';
import { checkIdentity, engineConfig, identify } from './lib/engines.mjs';
import { runGroups } from './lib/runner.mjs';
import { fixtureNames, paths } from './lib/paths.mjs';

const usage = 'usage: node harness/run.mjs --engine <elasticsearch|opensearch|eloisesearch> [--url URL] [--only ids] [--out dir]';
const args = cli({
  engine: { type: 'string' },
  url: { type: 'string' },
  only: { type: 'string' },
  out: { type: 'string', default: paths.reports },
}, usage);
if (!args.engine) fail(usage);

const engine = engineConfig(args.engine, args.url);
const groups = await loadGroups(paths.cases);
const errors = validateGroups(groups, await loadDivergences(paths.divergences), await fixtureNames());
if (errors.length) fail(`invalid cases:\n  ${errors.join('\n  ')}`);

let identity;
try {
  identity = await identify(engine.url);
  checkIdentity(engine, identity);
} catch (error) {
  fail(`${engine.name}: ${error.message}`);
}
console.log(`${engine.name} ${identity.version} at ${engine.url}`);

const only = args.only ? args.only.split(',').map(id => id.trim()) : null;
const report = await runGroups({ engine, identity, groups, fixturesDir: paths.fixtures, only, log: line => console.log(line) });

await mkdir(args.out, { recursive: true });
const file = path.join(args.out, `${engine.name}-${identity.version}.json`);
await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
const { pass, fail: failed, error } = report.summary;
console.log(`\n${pass} passed, ${failed} failed, ${error} errors; report: ${file}`);

// Eloisesearch runs are report-only until its capabilities are implemented.
if (engine.reference && (failed > 0 || error > 0)) process.exit(1);
