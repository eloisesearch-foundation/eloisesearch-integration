// Tests over the committed contracts: they must validate; the index and
// document groups must run cleanly against the fake engine (which checks the
// harness, not the references); and every fixture must load. Search and
// mapping cases need a real engine: they are verified against the references.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

// The groups whose behavior the fake engine implements. Search and mapping
// semantics (analysis, queries, dynamic mapping) are verified on the references.
const FAKE_GROUPS = ['index-lifecycle', 'documents'];

test('the index and document cases run end to end and clean up every index they create', async () => {
  const groups = (await loadGroups(paths.cases)).filter(group => FAKE_GROUPS.includes(group.group));
  assert.equal(groups.length, FAKE_GROUPS.length);
  const engine = engineAt('elasticsearch', fake.url);
  const report = await runGroups({ engine, identity: await identify(fake.url), groups, fixturesDir: paths.fixtures, run: 'test0001' });

  const failures = report.cases.filter(entry => entry.outcome !== 'pass');
  assert.deepEqual(failures.map(entry => ({ id: entry.id, steps: entry.steps.filter(step => step.outcome !== 'pass') })), []);
  assert.equal(report.summary.pass, groups.reduce((sum, group) => sum + group.cases.length, 0));
  assert.equal(fake.indexes.size, 0, `left behind: ${[...fake.indexes.keys()].join(', ')}`);
  assert.ok(fake.deleted.every(name => name.startsWith('contract-test0001-')));
});

test('every fixture loads: valid documents, unique ids, the advertised count', async () => {
  for (const name of await fixtureNames()) {
    const lines = (await readFile(path.join(paths.fixtures, name, 'documents.ndjson'), 'utf8')).split('\n').filter(Boolean);
    const ids = lines.map(line => JSON.parse(line)._id);
    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate _id`);

    const groups = [{ group: 'probe', fixture: name, cases: [
      { id: `probe-${name}`, capability: 'c', description: 'd', request: { method: 'GET', path: '/{{index}}/_count' }, expect: { body: { count: ids.length } } },
    ] }];
    const report = await runGroups({ engine: engineAt('elasticsearch', fake.url), identity: {}, groups, fixturesDir: paths.fixtures, run: 'fixt0001' });
    assert.deepEqual(report.summary, { pass: 1, fail: 0, error: 0 }, `${name}: ${JSON.stringify(report.cases[0]?.steps)}`);
  }
  assert.equal(fake.indexes.size, 0);
});
