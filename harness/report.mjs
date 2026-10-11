#!/usr/bin/env node
// Summarize every report in reports/ side by side into reports/summary.md.
//
//   node harness/report.mjs [--dir reports]

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cli, fail } from './lib/args.mjs';
import { paths } from './lib/paths.mjs';
import { summarize } from './lib/summary.mjs';

const args = cli({ dir: { type: 'string', default: paths.reports } }, 'usage: node harness/report.mjs [--dir reports]');

let files;
try {
  files = (await readdir(args.dir)).filter(name => name.endsWith('.json'));
} catch {
  files = [];
}
if (files.length === 0) fail(`no reports in ${args.dir}; run make reference-test first`);

const reports = await Promise.all(files.map(async name => JSON.parse(await readFile(path.join(args.dir, name), 'utf8'))));
const markdown = summarize(reports);
const out = path.join(args.dir, 'summary.md');
await writeFile(out, markdown);
console.log(markdown);
console.log(`written to ${out}`);
