#!/usr/bin/env node
// Write contracts/baselines/<engine>-<version>.json from the reference reports.
//
//   node harness/baseline.mjs [--dir reports]
//
// Review the diff before committing: a baseline is evidence that a person
// checked, never an expectation by itself.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cli, fail } from './lib/args.mjs';
import { baselineOf } from './lib/baseline.mjs';
import { ENGINES } from './lib/engines.mjs';
import { paths } from './lib/paths.mjs';

const args = cli({ dir: { type: 'string', default: paths.reports } }, 'usage: node harness/baseline.mjs [--dir reports]');
const out = path.join(paths.root, 'contracts', 'baselines');

let files;
try {
  files = (await readdir(args.dir)).filter(name => name.endsWith('.json'));
} catch {
  files = [];
}
const reports = await Promise.all(files.map(async name => JSON.parse(await readFile(path.join(args.dir, name), 'utf8'))));
const references = reports.filter(report => ENGINES[report.engine]?.reference);
if (references.length === 0) fail(`no reference reports in ${args.dir}; run make reference-test first`);

await mkdir(out, { recursive: true });
for (const report of references) {
  let baseline;
  try {
    baseline = baselineOf(report);
  } catch (error) {
    fail(error.message);
  }
  const file = path.join(out, `${report.engine}-${report.identity.version}.json`);
  await writeFile(file, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`wrote ${path.relative(paths.root, file)} (${baseline.cases_passed} cases)`);
}
console.log('review with: git diff contracts/baselines');
