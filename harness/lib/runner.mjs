// Run the cases against one engine and build the report.

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { send } from './client.mjs';
import { evaluate, observe } from './expect.mjs';
import { stepsOf } from './cases.mjs';
import { substitute } from './template.mjs';

export const HARNESS_FORMAT = 1;

export const newRunId = () => randomBytes(4).toString('hex');

const indexPrefix = run => `contract-${run}-`;

/** A valid index name for a case: lowercase, no characters the references reject. */
export function scratchName(run, caseId) {
  return `${indexPrefix(run)}${caseId}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 200);
}

/** Replace the run id in observations so runs of the same version can be compared. */
export function withoutRunId(value, run) {
  return JSON.parse(JSON.stringify(value).replaceAll(indexPrefix(run), indexPrefix('{{run}}')));
}

async function loadFixture(fixturesDir, name) {
  const dir = path.join(fixturesDir, name);
  const mapping = JSON.parse(await readFile(path.join(dir, 'mapping.json'), 'utf8'));
  const documents = (await readFile(path.join(dir, 'documents.ndjson'), 'utf8'))
    .split('\n')
    .filter(line => line.trim())
    .map((line, i) => {
      const doc = JSON.parse(line);
      if (typeof doc._id !== 'string' || !doc._source) {
        throw new Error(`${name}/documents.ndjson line ${i + 1}: expected {"_id": "...", "_source": {...}}`);
      }
      return doc;
    });
  return { mapping, documents };
}

/** Create the fixture index, bulk-load it with refresh=true and check the count. */
async function setUpFixture(baseUrl, index, fixture) {
  const created = await send(baseUrl, { method: 'PUT', path: `/${index}`, body: fixture.mapping });
  if (created.status !== 200) throw new Error(`creating fixture index ${index}: HTTP ${created.status} ${created.text.slice(0, 500)}`);
  const ndjson = fixture.documents.flatMap(doc => [{ index: { _index: index, _id: doc._id } }, doc._source]);
  const bulk = await send(baseUrl, { method: 'POST', path: '/_bulk', query: { refresh: 'true' }, ndjson });
  if (bulk.status !== 200 || bulk.body?.errors !== false) {
    const failed = (bulk.body?.items ?? []).filter(item => item.index?.error).slice(0, 3);
    throw new Error(`loading fixture into ${index}: HTTP ${bulk.status} ${JSON.stringify(failed) || bulk.text.slice(0, 500)}`);
  }
  const count = await send(baseUrl, { method: 'GET', path: `/${index}/_count` });
  if (count.body?.count !== fixture.documents.length) {
    throw new Error(`fixture ${index} has ${count.body?.count} documents, expected ${fixture.documents.length}`);
  }
}

async function deleteIndex(baseUrl, index) {
  await send(baseUrl, { method: 'DELETE', path: `/${index}` }).catch(() => {});
}

/** The expectation for this engine: the step's, with the engine's keys replacing it. */
function expectationFor(step, engineName) {
  const override = step.engines?.[engineName];
  if (!override?.expect) return { expect: step.expect, divergence: override?.divergence };
  return { expect: { ...step.expect, ...override.expect }, divergence: override.divergence };
}

async function runCase({ engine, testCase, vars, log }) {
  const steps = [];
  let outcome = 'pass';
  for (const [i, rawStep] of stepsOf(testCase).entries()) {
    const step = substitute(rawStep, vars);
    const { expect, divergence } = expectationFor(step, engine.name);
    const entry = { request: { method: step.request.method, path: step.request.path } };
    if (step.request.query) entry.request.query = step.request.query;
    try {
      const response = await send(engine.url, step.request);
      if (expect === undefined) {
        // A setup step: it must succeed, nothing else is checked.
        entry.outcome = response.status >= 200 && response.status < 300 ? 'pass' : 'fail';
        entry.checks = [{ name: 'setup status 2xx', ok: entry.outcome === 'pass', expected: '2xx', observed: response.status }];
        entry.observed = { status: response.status };
      } else {
        entry.checks = evaluate(expect, response);
        entry.outcome = entry.checks.every(check => check.ok) ? 'pass' : 'fail';
        entry.observed = observe(expect, response);
      }
      if (divergence) entry.divergence = divergence;
    } catch (error) {
      entry.outcome = 'error';
      entry.error = error.message;
    }
    if (entry.outcome !== 'pass' && outcome !== 'error') outcome = entry.outcome;
    steps.push(entry);
    if (entry.outcome === 'error') {
      log(`  step ${i + 1} error: ${entry.error}`);
      break; // the engine did not answer; later steps would only repeat the error
    }
  }
  return { outcome, steps };
}

/**
 * Run every group against an engine whose identity was already checked.
 * Returns the report object; never throws for a failing case.
 */
export async function runGroups({ engine, identity, groups, fixturesDir, only, run = newRunId(), log = () => {} }) {
  const report = {
    format: HARNESS_FORMAT,
    engine: engine.name,
    identity,
    url: engine.url,
    run,
    cases: [],
    summary: { pass: 0, fail: 0, error: 0 },
  };
  const fixtureIndexes = new Map();
  try {
    for (const group of groups) {
      const cases = group.cases.filter(testCase => !only || only.includes(testCase.id));
      if (cases.length === 0) continue;
      let index = null;
      if (group.fixture) {
        if (!fixtureIndexes.has(group.fixture)) {
          const name = `${indexPrefix(run)}${group.fixture}`;
          fixtureIndexes.set(group.fixture, name);
          log(`loading fixture ${group.fixture} into ${name}`);
          await setUpFixture(engine.url, name, await loadFixture(fixturesDir, group.fixture));
        }
        index = fixtureIndexes.get(group.fixture);
      }
      for (const testCase of cases) {
        const scratch = scratchName(run, testCase.id);
        const vars = { index, scratch, run };
        let result;
        try {
          result = await runCase({ engine, testCase, vars, log });
        } finally {
          await deleteIndex(engine.url, scratch);
        }
        report.summary[result.outcome] += 1;
        report.cases.push({
          group: group.group,
          id: testCase.id,
          capability: testCase.capability,
          outcome: result.outcome,
          steps: result.steps,
        });
        log(`${result.outcome.padEnd(5)} ${group.group}/${testCase.id}`);
      }
    }
  } finally {
    for (const name of fixtureIndexes.values()) await deleteIndex(engine.url, name);
  }
  return report;
}
