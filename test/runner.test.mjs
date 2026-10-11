import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { checkIdentity, engineConfig, identify } from '../harness/lib/engines.mjs';
import { runGroups } from '../harness/lib/runner.mjs';
import { summarize } from '../harness/lib/summary.mjs';
import { startFakeEngine } from './fake-engine.mjs';

let fake;
before(async () => { fake = await startFakeEngine(); });
after(async () => { await fake.close(); });

const engineAt = (name, url) => engineConfig(name, url);

test('identity is read from GET / and checked against the pin', async () => {
  const identity = await identify(fake.url);
  assert.deepEqual(identity, { distribution: 'elasticsearch', version: '9.5.4' });
  assert.throws(() => checkIdentity(engineAt('opensearch', fake.url), identity), /expected opensearch/);

  const old = await startFakeEngine({ distribution: 'opensearch', version: '3.8.0' });
  try {
    const oldIdentity = await identify(old.url);
    assert.throws(() => checkIdentity(engineAt('opensearch', old.url), oldIdentity), /pinned reference is 3\.9\.0/);
  } finally {
    await old.close();
  }
});

async function tempContracts({ cases, fixture }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'harness-'));
  await mkdir(path.join(dir, 'fixtures', 'tiny'), { recursive: true });
  if (fixture) {
    await writeFile(path.join(dir, 'fixtures', 'tiny', 'mapping.json'), JSON.stringify({ mappings: { properties: { title: { type: 'text' } } } }));
    await writeFile(path.join(dir, 'fixtures', 'tiny', 'documents.ndjson'), fixture.map(doc => JSON.stringify(doc)).join('\n') + '\n');
  }
  return { fixturesDir: path.join(dir, 'fixtures'), groups: [{ group: 'g', fixture: fixture ? 'tiny' : null, cases }] };
}

test('fixtures are loaded once, searched, and deleted afterwards', async () => {
  const { fixturesDir, groups } = await tempContracts({
    fixture: [{ _id: 'a', _source: { title: 'One' } }, { _id: 'b', _source: { title: 'Two' } }],
    cases: [
      { id: 'all', capability: 'c', description: 'd', request: { method: 'POST', path: '/{{index}}/_search', body: { query: { match_all: {} } } }, expect: { hits: { ids_exact: ['a', 'b'] } } },
      { id: 'count', capability: 'c', description: 'd', request: { method: 'GET', path: '/{{index}}/_count' }, expect: { body: { count: 2 } } },
    ],
  });
  const report = await runGroups({ engine: engineAt('elasticsearch', fake.url), identity: {}, groups, fixturesDir, run: 'fix00001' });
  assert.deepEqual(report.summary, { pass: 2, fail: 0, error: 0 });
  assert.ok(fake.deleted.includes('contract-fix00001-tiny'));
  assert.equal(fake.indexes.size, 0);
});

test('failures, engine overrides and connection errors are reported, not thrown', async () => {
  const { fixturesDir, groups } = await tempContracts({
    cases: [
      { id: 'wrong', capability: 'c', description: 'd', request: { method: 'GET', path: '/{{scratch}}' }, expect: { status: 200 } },
      { id: 'override', capability: 'c', description: 'd', request: { method: 'GET', path: '/{{scratch}}' }, expect: { status: 200 },
        engines: { elasticsearch: { expect: { status: 404 }, divergence: 'D-001' } } },
    ],
  });
  const report = await runGroups({ engine: engineAt('elasticsearch', fake.url), identity: { version: '9.5.4' }, groups, fixturesDir, run: 'err00001' });
  assert.equal(report.cases[0].outcome, 'fail');
  assert.equal(report.cases[0].steps[0].checks[0].observed, 404);
  assert.equal(report.cases[1].outcome, 'pass');
  assert.equal(report.cases[1].steps[0].divergence, 'D-001');

  const down = await runGroups({ engine: engineAt('elasticsearch', 'http://127.0.0.1:9'), identity: {}, groups, fixturesDir, run: 'err00002' });
  assert.deepEqual(down.summary, { pass: 0, fail: 0, error: 2 });
  assert.match(down.cases[0].steps[0].error, /fetch failed/);
});

test('the summary lines up engines, flags disagreement and lists failures', () => {
  const entry = (id, outcome, ids, extra = {}) => ({ group: 'g', id, capability: 'c', outcome, steps: [{ request: { method: 'POST', path: `/contract-RUN-x/_search` }, outcome, checks: outcome === 'pass' ? [] : [{ name: 'hits.ids_exact', ok: false, expected: ['1'], observed: ids }], observed: { status: 200, ids }, ...extra }] });
  const fix = (report) => JSON.parse(JSON.stringify(report).replaceAll('RUN', report.run));
  const es = fix({ engine: 'elasticsearch', identity: { version: '9.5.4' }, run: 'r1', summary: { pass: 2, fail: 0, error: 0 }, cases: [entry('same', 'pass', ['1']), entry('differs', 'pass', ['1'])] });
  const os = fix({ engine: 'opensearch', identity: { version: '3.9.0' }, run: 'r2', summary: { pass: 1, fail: 1, error: 0 }, cases: [entry('same', 'pass', ['1']), entry('differs', 'fail', ['2'], { divergence: 'D-002' })] });
  const markdown = summarize([os, es]);
  assert.match(markdown, /\| Group \| Case \| elasticsearch 9\.5\.4 \| opensearch 3\.9\.0 \| References agree \|/);
  assert.match(markdown, /\| g \| same \| pass \| pass \| yes \|/);
  assert.match(markdown, /\| g \| differs \| pass \| fail \(D-002\) \| \*\*no\*\* \|/);
  assert.match(markdown, /### opensearch 3\.9\.0: g\/differs/);
  assert.match(markdown, /`POST \/contract-\{\{run\}\}-x\/_search`: `hits\.ids_exact` expected `\["1"\]`, observed `\["2"\]`/);
});
