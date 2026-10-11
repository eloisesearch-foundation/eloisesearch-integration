// Tests over the committed contracts: they must validate, and they must run
// cleanly against the fake engine (which checks the harness, not the references).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadDivergences, loadGroups, validateGroups } from '../harness/lib/cases.mjs';
import { engineConfig, identify } from '../harness/lib/engines.mjs';
import { fixtureNames, paths } from '../harness/lib/paths.mjs';
import { runGroups } from '../harness/lib/runner.mjs';
import { startFakeEngine } from './fake-engine.mjs';

let fake;
before(async () => { fake = await startFakeEngine(); });
after(async () => { await fake.close(); });

const engineAt = (name, url) => engineConfig(name, url);

test('the committed contracts are valid', async () => {
  const groups = await loadGroups(paths.cases);
  assert.ok(groups.length > 0);
  assert.deepEqual(validateGroups(groups, await loadDivergences(paths.divergences), await fixtureNames()), []);
});

test('the committed cases run end to end and clean up every index they create', async () => {
  const groups = await loadGroups(paths.cases);
  const engine = engineAt('elasticsearch', fake.url);
  const report = await runGroups({ engine, identity: await identify(fake.url), groups, fixturesDir: paths.fixtures, run: 'test0001' });

  const failures = report.cases.filter(entry => entry.outcome !== 'pass');
  assert.deepEqual(failures.map(entry => ({ id: entry.id, steps: entry.steps.filter(step => step.outcome !== 'pass') })), []);
  assert.equal(report.summary.pass, groups.reduce((sum, group) => sum + group.cases.length, 0));
  assert.equal(fake.indexes.size, 0, `left behind: ${[...fake.indexes.keys()].join(', ')}`);
  assert.ok(fake.deleted.every(name => name.startsWith('contract-test0001-')));
});
