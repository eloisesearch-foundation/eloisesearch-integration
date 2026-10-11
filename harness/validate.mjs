#!/usr/bin/env node
// Validate every case file and the divergence register (part of make check).

import { fail } from './lib/args.mjs';
import { loadDivergences, loadGroups, validateGroups } from './lib/cases.mjs';
import { fixtureNames, paths } from './lib/paths.mjs';

const DECISIONS = ['follow-elasticsearch', 'follow-opensearch', 'partial', 'unsupported', 'out-of-mvp', 'pending'];

const groups = await loadGroups(paths.cases);
const divergences = await loadDivergences(paths.divergences);
const errors = validateGroups(groups, divergences, await fixtureNames());

const caseIds = new Set(groups.flatMap(group => group.cases ?? []).map(testCase => testCase.id));
for (const [id, entry] of divergences) {
  if (!/^D-\d{3}$/.test(id)) errors.push(`divergences.json: id ${id} must look like D-001`);
  if (!DECISIONS.includes(entry.decision)) errors.push(`divergences.json ${id}: decision must be one of ${DECISIONS.join(', ')}`);
  for (const caseId of entry.cases ?? []) {
    if (!caseIds.has(caseId)) errors.push(`divergences.json ${id}: unknown case ${caseId}`);
  }
}

if (errors.length) fail(`invalid contracts:\n  ${errors.join('\n  ')}`);
const count = groups.reduce((sum, group) => sum + group.cases.length, 0);
console.log(`contracts ok: ${count} cases in ${groups.length} groups, ${divergences.size} divergences`);
