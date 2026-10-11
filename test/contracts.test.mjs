import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateGroups } from '../harness/lib/cases.mjs';

const group = cases => ({ group: 'g', description: 'd', fixture: null, cases });
const ok = { id: 'a', capability: 'c', description: 'd', request: { method: 'GET', path: '/{{scratch}}' }, expect: { status: 200 } };
const divergences = new Map([['D-001', { id: 'D-001' }]]);

test('a well-formed case is valid', () => {
  assert.deepEqual(validateGroups([group([ok])], divergences), []);
});

test('typos and structural mistakes are reported', () => {
  const errors = validateGroups([group([
    { ...ok, expcet: {} },
    { ...ok, id: 'b', expect: { stauts: 200, hits: { ids: [] } } },
    { ...ok, id: 'a' },
    { ...ok, id: 'Bad Id' },
    { ...ok, id: 'c', request: { method: 'FETCH', path: 'x' } },
    { ...ok, id: 'd', request: { method: 'GET', path: '/{{index}}' } },
    { ...ok, id: 'e', request: { method: 'GET', path: '/{{other}}' } },
    { ...ok, id: 'f', steps: [] },
    { ...ok, id: 'g', engines: { opensearch: { expect: { status: 404 } } } },
    { ...ok, id: 'h', engines: { opensearch: { expect: { status: 404 }, divergence: 'D-999' } } },
    { ...ok, id: 'i', engines: { solr: { divergence: 'D-001' } } },
    { ...ok, id: 'j', expect: { hits: { every: [{ field: 'x', near: 1 }] } } },
  ])], divergences);
  const expected = [
    /#a: unknown key "expcet"/,
    /#b.*unknown key "stauts"/,
    /#b.*hits: unknown key "ids"/,
    /#a: duplicate id/,
    /#Bad Id: id must be a lowercase id/,
    /#c.*method must be one of/,
    /#c.*path must start with \//,
    /#d: \{\{index\}\} needs a group fixture/,
    /#e: unknown placeholder \{\{other\}\}/,
    /#f: use steps, or request\/expect, not both/,
    /#g.*must cite a divergence/,
    /#h.*D-999 is not recorded/,
    /#i.*unknown engine/,
    /#j.*predicate needs exactly one of/,
  ];
  for (const pattern of expected) assert.ok(errors.some(error => pattern.test(error)), `missing error ${pattern}\n${errors.join('\n')}`);
});

test('an engine override with a recorded divergence is valid', () => {
  const testCase = { ...ok, engines: { opensearch: { expect: { status: 404 }, divergence: 'D-001' } } };
  assert.deepEqual(validateGroups([group([testCase])], divergences), []);
});
