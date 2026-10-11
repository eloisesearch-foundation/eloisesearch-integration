import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, isMatcher, observe } from '../harness/lib/expect.mjs';
import { MISSING, lookup, lookupAll, parsePath } from '../harness/lib/path.mjs';
import { placeholdersIn, substitute } from '../harness/lib/template.mjs';
import { buildRequest } from '../harness/lib/client.mjs';
import { checkIdentity, engineConfig } from '../harness/lib/engines.mjs';
import { scratchName, withoutRunId } from '../harness/lib/runner.mjs';

const failed = checks => checks.filter(check => !check.ok).map(check => check.name);

test('placeholders are replaced in values and keys, and unknown ones fail', () => {
  const vars = { index: 'contract-ab-movies', scratch: 'contract-ab-case', run: 'ab' };
  assert.deepEqual(
    substitute({ path: '/{{scratch}}/_doc/1', body: { '{{scratch}}.x': '{{index}}' } }, vars),
    { path: '/contract-ab-case/_doc/1', body: { 'contract-ab-case.x': 'contract-ab-movies' } },
  );
  assert.throws(() => substitute('/{{nope}}', vars), /unknown or unset placeholder \{\{nope\}\}/);
  assert.throws(() => substitute('/{{index}}', { ...vars, index: null }), /unset/);
  assert.deepEqual([...placeholdersIn({ a: ['{{run}}'], '{{index}}': 1 })].sort(), ['index', 'run']);
});

test('paths reach nested fields, array elements and every element', () => {
  const body = { items: [{ index: { status: 201 } }, { create: { status: 409 } }], hits: { hits: [{ _id: '1' }, { _id: '2' }] } };
  assert.deepEqual(parsePath('items[0].index.status'), ['items', 0, 'index', 'status']);
  assert.equal(lookup(body, 'items[0].index.status'), 201);
  assert.equal(lookup(body, 'items[1].index'), MISSING);
  assert.equal(lookup(body, 'items[5].index'), MISSING);
  assert.deepEqual(lookupAll(body, 'hits.hits[]._id'), ['1', '2']);
  assert.deepEqual(lookupAll({ hits: { hits: [] } }, 'hits.hits[]._id'), []);
  assert.throws(() => parsePath('a..b'), /invalid path/);
});

test('matchers are recognized only in their exact shapes', () => {
  assert.ok(isMatcher({ exists: true }));
  assert.ok(isMatcher({ type: 'number' }));
  assert.ok(!isMatcher({ type: 'text' }), 'a mapping type is a literal, not a matcher');
  assert.ok(!isMatcher({ exists: true, type: 'number' }));
});

test('status, error envelope, body values and shape', () => {
  const response = {
    status: 404,
    body: { error: { root_cause: [{ type: 'index_not_found_exception', reason: 'r' }], type: 'index_not_found_exception', reason: 'r' }, status: 404 },
  };
  const expect = {
    status: 404,
    error: { type: 'index_not_found_exception', root_cause_type: 'index_not_found_exception' },
    body: { status: 404, 'error.index': { absent: true }, 'error.reason': { type: 'string' } },
    shape: ['error.root_cause[].type', 'error.type'],
  };
  assert.deepEqual(failed(evaluate(expect, response)), []);
  assert.deepEqual(failed(evaluate({ status: 400, error: { type: 'other' }, body: { status: { exists: true }, nope: 1 }, shape: ['missing[].x'] }, response)),
    ['status', 'error.type', 'body.nope', 'shape missing[].x']);
});

test('hit expectations: totals, id sets, order, sorting and predicates', () => {
  const hit = (_id, _source) => ({ _id, _score: 1, _source });
  const body = { hits: { total: { value: 3, relation: 'eq' }, hits: [
    hit('2', { popularity: 110, tmdb_id: '2', genres: ['Action'], vote_average: 8, title: 'Spider-Man' }),
    hit('1', { popularity: 100, tmdb_id: '1', genres: ['Action', 'Drama'], vote_average: 7.3, title: 'Spider-Man 2' }),
    hit('3', { popularity: 100, tmdb_id: '3', genres: ['Action'], vote_average: 7, title: 'Homecoming' }),
  ] } };
  const pass = {
    total: { value: 3, relation: 'eq' },
    ids_exact: ['1', '2', '3'],
    ids_include: ['2'],
    ids_exclude: ['9'],
    ids_ordered: ['2', '1', '3'],
    sorted_by: [{ field: 'popularity', order: 'desc' }, { field: 'tmdb_id', order: 'asc' }],
    every: [{ field: 'genres', contains: 'Action' }, { field: 'vote_average', gte: 7 }, { fields: ['title'], not_matches: 'horror' }],
  };
  assert.deepEqual(failed(evaluate({ hits: pass }, { status: 200, body })), []);
  const fail = {
    total: 2,
    ids_exact: ['1', '2'],
    ids_include: ['9'],
    ids_exclude: ['3'],
    ids_ordered: ['1', '2', '3'],
    sorted_by: [{ field: 'popularity', order: 'asc' }],
    every: [{ field: 'genres', contains: 'Drama' }, { fields: ['title'], matches: 'spider' }],
  };
  assert.equal(failed(evaluate({ hits: fail }, { status: 200, body })).length, 8);
  assert.deepEqual(failed(evaluate({ hits: { total: 3 } }, { status: 200, body: { hits: { total: 3, hits: [] } } })), []);
});

test('aggregations, highlight and suggestions', () => {
  const body = {
    hits: { hits: [{ _id: '194', highlight: { title: ['<mark>Amélie</mark>'] } }] },
    aggregations: { genres: { buckets: [{ key: 'Comedy', doc_count: 2 }, { key: 'Action', doc_count: 1 }] } },
    suggest: { title_suggest: [{ options: [{ text: 'Spider-Man' }, { text: 'Spider-Man 3' }] }] },
  };
  const expect = {
    aggregations: { genres: [{ key: 'Action', doc_count: 1 }, { key: 'Comedy', doc_count: 2 }] },
    highlight: { 194: { title: { contains: '<mark>Amélie</mark>' } } },
    suggest: { title_suggest: { texts_include: ['spider-man'], unique_texts: true, max: 5 } },
  };
  assert.deepEqual(failed(evaluate(expect, { status: 200, body })), []);
  const wrong = {
    aggregations: { genres: [{ key: 'Action', doc_count: 2 }], years: [] },
    highlight: { 194: { overview: { exists: true } }, 1: { title: { exists: true } } },
    suggest: { title_suggest: { texts_include: ['Avengers'], max: 1 }, other: {} },
  };
  assert.equal(failed(evaluate(wrong, { status: 200, body })).length, 7);
});

test('observations keep what is comparable and nothing else', () => {
  const response = {
    status: 200,
    body: { took: 3, hits: { total: { value: 1, relation: 'eq' }, max_score: 2.5, hits: [{ _id: '1', _score: 2.5 }] }, result: 'created' },
  };
  assert.deepEqual(observe({ body: { result: 'created', nope: 1 } }, response), {
    status: 200,
    ids: ['1'],
    total: { value: 1, relation: 'eq' },
    body: { result: 'created', nope: '(missing)' },
  });
});

test('requests: JSON bodies, NDJSON with a final newline, raw strings and query strings', () => {
  const ndjson = buildRequest('http://x', { method: 'POST', path: '/_bulk', query: { refresh: 'true' }, ndjson: [{ index: {} }, { a: 1 }] });
  assert.equal(String(ndjson.url), 'http://x/_bulk?refresh=true');
  assert.equal(ndjson.init.headers['content-type'], 'application/x-ndjson');
  assert.equal(ndjson.init.body, '{"index":{}}\n{"a":1}\n');
  const json = buildRequest('http://x', { method: 'PUT', path: '/i', body: { a: 1 } });
  assert.equal(json.init.headers['content-type'], 'application/json');
  assert.equal(json.init.body, '{"a":1}');
  assert.equal(buildRequest('http://x', { method: 'PUT', path: '/i', body: '{"a": ' }).init.body, '{"a": ');
  assert.equal(buildRequest('http://x', { method: 'GET', path: '/i' }).init.body, undefined);
});

test('engine identity must match the pinned reference', () => {
  const es = engineConfig('elasticsearch', 'http://es/');
  assert.equal(es.url, 'http://es');
  assert.doesNotThrow(() => checkIdentity(es, { distribution: 'elasticsearch', version: '9.5.4' }));
  assert.throws(() => checkIdentity(es, { distribution: 'elasticsearch', version: '9.5.3' }), /pinned reference is 9\.5\.4/);
  assert.throws(() => checkIdentity(es, { distribution: 'opensearch', version: '3.9.0' }), /expected elasticsearch/);
  const elo = engineConfig('eloisesearch');
  assert.doesNotThrow(() => checkIdentity(elo, { distribution: 'eloisesearch', version: '0.1.0' }));
  assert.throws(() => engineConfig('solr'), /unknown engine/);
});

test('index names are valid and run ids can be removed from observations', () => {
  assert.equal(scratchName('ab12', 'Create_Index!'), 'contract-ab12-create_index-');
  assert.deepEqual(withoutRunId({ path: '/contract-ab12-x', other: 'ab12' }, 'ab12'), { path: '/contract-{{run}}-x', other: 'ab12' });
});
