// Expectations: turn a step's `expect` block and a response into checks.
//
// Each check is { name, ok, expected, observed }. Only what the case names is
// checked; scores, timings and identifiers are never looked at.

import { isDeepStrictEqual } from 'node:util';
import { MISSING, lookup, lookupAll } from './path.mjs';

export const EXPECT_KEYS = ['status', 'error', 'body', 'shape', 'hits', 'aggregations', 'highlight', 'suggest'];
export const HITS_KEYS = ['total', 'ids_exact', 'ids_include', 'ids_exclude', 'ids_ordered', 'sorted_by', 'every'];
const MATCHER_TYPES = ['number', 'string', 'boolean', 'object', 'array', 'null'];

const show = value => (value === MISSING ? '(missing)' : value);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** A body value is a matcher when it is {exists}, {absent} or {type: <json type>}. */
export function isMatcher(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  if (keys[0] === 'exists' || keys[0] === 'absent') return value[keys[0]] === true;
  return keys[0] === 'type' && MATCHER_TYPES.includes(value.type);
}

function matches(expected, observed) {
  if (isMatcher(expected)) {
    if (expected.exists) return observed !== MISSING;
    if (expected.absent) return observed === MISSING;
    return observed !== MISSING && typeOf(observed) === expected.type;
  }
  return observed !== MISSING && isDeepStrictEqual(observed, expected);
}

export const hitIds = body => lookupAll(body, 'hits.hits[]._id').filter(id => id !== MISSING);
const hits = body => lookupAll(body, 'hits.hits[]').filter(hit => hit !== MISSING);

export function totalOf(body) {
  const total = lookup(body, 'hits.total');
  if (total === MISSING) return MISSING;
  return typeof total === 'number' ? { value: total } : total;
}

export function bucketsOf(body, name) {
  const buckets = lookup(body, `aggregations.${name}.buckets`);
  if (!Array.isArray(buckets)) return MISSING;
  return buckets.map(({ key, doc_count }) => ({ key, doc_count }));
}

export function suggestionTexts(body, name) {
  const texts = lookupAll(body, `suggest.${name}[0].options[].text`);
  return texts.includes(MISSING) ? MISSING : texts;
}

const sortBuckets = buckets =>
  [...buckets].sort((a, b) => String(a.key).localeCompare(String(b.key)));

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1; // missing values sort last, as in the references
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function sourceValue(hit, field) {
  const value = lookup(hit._source ?? {}, field);
  return value === MISSING ? undefined : value;
}

function predicateHolds(predicate, hit) {
  const { field, fields, ...ops } = predicate;
  const [op, operand] = Object.entries(ops)[0];
  if (op === 'matches' || op === 'not_matches') {
    const text = (fields ?? [field])
      .map(name => sourceValue(hit, name))
      .flat()
      .filter(value => value != null)
      .join(' ');
    const found = new RegExp(operand, 'iu').test(text);
    return op === 'matches' ? found : !found;
  }
  const value = sourceValue(hit, field);
  switch (op) {
    case 'equals': return isDeepStrictEqual(value, operand);
    case 'contains':
      return Array.isArray(value) ? value.includes(operand)
        : typeof value === 'string' && value.includes(operand);
    case 'gte': return typeof value === 'number' && value >= operand;
    case 'gt': return typeof value === 'number' && value > operand;
    case 'lte': return typeof value === 'number' && value <= operand;
    case 'lt': return typeof value === 'number' && value < operand;
    default: throw new Error(`unknown predicate operator "${op}"`);
  }
}

export const PREDICATE_OPS = ['equals', 'contains', 'gte', 'gt', 'lte', 'lt', 'matches', 'not_matches'];

function checkHits(spec, body, checks) {
  const ids = hitIds(body);
  const idSet = new Set(ids);
  const add = (name, ok, expected, observed) => checks.push({ name: `hits.${name}`, ok, expected, observed });

  if ('total' in spec) {
    const total = totalOf(body);
    const expected = typeof spec.total === 'number' ? { value: spec.total } : spec.total;
    const observed = total === MISSING ? MISSING
      : Object.fromEntries(Object.keys(expected).map(key => [key, total[key]]));
    add('total', observed !== MISSING && isDeepStrictEqual(observed, expected), expected, show(observed));
  }
  if (spec.ids_exact) {
    const ok = idSet.size === ids.length && isDeepStrictEqual([...idSet].sort(), [...spec.ids_exact].sort());
    add('ids_exact', ok, [...spec.ids_exact].sort(), [...ids].sort());
  }
  if (spec.ids_include) {
    const missing = spec.ids_include.filter(id => !idSet.has(id));
    add('ids_include', missing.length === 0, spec.ids_include, missing.length ? { missing, ids } : ids);
  }
  if (spec.ids_exclude) {
    const present = spec.ids_exclude.filter(id => idSet.has(id));
    add('ids_exclude', present.length === 0, spec.ids_exclude, present.length ? { present, ids } : ids);
  }
  if (spec.ids_ordered) {
    add('ids_ordered', isDeepStrictEqual(ids, spec.ids_ordered), spec.ids_ordered, ids);
  }
  if (spec.sorted_by) {
    const list = hits(body);
    let violation = null;
    for (let i = 1; i < list.length && !violation; i++) {
      for (const { field, order = 'asc' } of spec.sorted_by) {
        const cmp = compareValues(sourceValue(list[i - 1], field), sourceValue(list[i], field));
        const wrong = order === 'desc' ? cmp < 0 : cmp > 0;
        if (wrong) {
          violation = { between: [list[i - 1]._id, list[i]._id], field, order };
          break;
        }
        if (cmp !== 0) break;
      }
    }
    add('sorted_by', violation === null, spec.sorted_by, violation ?? ids);
  }
  for (const predicate of spec.every ?? []) {
    const failing = hits(body).filter(hit => !predicateHolds(predicate, hit)).map(hit => hit._id);
    add(`every ${JSON.stringify(predicate)}`, failing.length === 0, predicate, failing.length ? { failing } : ids);
  }
}

/** Evaluate an expect block against a response { status, body }. */
export function evaluate(expect, response) {
  const checks = [];
  const body = response.body ?? {};
  const add = (name, ok, expected, observed) => checks.push({ name, ok, expected, observed: show(observed) });

  if ('status' in expect) add('status', response.status === expect.status, expect.status, response.status);

  if (expect.error) {
    const type = lookup(body, 'error.type');
    add('error.type', type === expect.error.type, expect.error.type, type);
    if (expect.error.root_cause_type) {
      const cause = lookup(body, 'error.root_cause[0].type');
      add('error.root_cause[0].type', cause === expect.error.root_cause_type, expect.error.root_cause_type, cause);
    }
  }

  for (const [path, expected] of Object.entries(expect.body ?? {})) {
    const observed = lookup(body, path);
    add(`body.${path}`, matches(expected, observed), expected, observed);
  }

  for (const path of expect.shape ?? []) {
    const values = lookupAll(body, path);
    const ok = values.length > 0 && !values.includes(MISSING);
    const partly = values.length > 1 && values.some(value => value !== MISSING);
    add(`shape ${path}`, ok, 'present', ok ? 'present' : partly ? 'missing in some elements' : 'missing');
  }

  if (expect.hits) checkHits(expect.hits, body, checks);

  for (const [name, expected] of Object.entries(expect.aggregations ?? {})) {
    const observed = bucketsOf(body, name);
    const ok = observed !== MISSING && isDeepStrictEqual(sortBuckets(observed), sortBuckets(expected));
    add(`aggregations.${name}`, ok, sortBuckets(expected), observed === MISSING ? MISSING : sortBuckets(observed));
  }

  for (const [id, fields] of Object.entries(expect.highlight ?? {})) {
    const hit = hits(body).find(candidate => candidate._id === id);
    for (const [field, spec] of Object.entries(fields)) {
      const fragments = hit?.highlight?.[field];
      const text = Array.isArray(fragments) ? fragments.join(' … ') : MISSING;
      const ok = spec.contains !== undefined ? text !== MISSING && text.includes(spec.contains) : text !== MISSING;
      add(`highlight.${id}.${field}`, ok, spec, hit ? text : `(no hit ${id})`);
    }
  }

  for (const [name, spec] of Object.entries(expect.suggest ?? {})) {
    const texts = suggestionTexts(body, name);
    if (texts === MISSING) {
      add(`suggest.${name}`, false, spec, MISSING);
      continue;
    }
    if (spec.texts_include) {
      const lower = texts.map(text => text.toLowerCase());
      const missing = spec.texts_include.filter(text => !lower.includes(text.toLowerCase()));
      add(`suggest.${name}.texts_include`, missing.length === 0, spec.texts_include, texts);
    }
    if (spec.unique_texts) {
      const lower = texts.map(text => text.toLowerCase());
      add(`suggest.${name}.unique_texts`, new Set(lower).size === lower.length, true, texts);
    }
    if (spec.max !== undefined) add(`suggest.${name}.max`, texts.length <= spec.max, spec.max, texts.length);
  }

  return checks;
}

/**
 * What a response looked like, normalized for reports and for comparing
 * engines: never scores, timings, reasons or identifiers.
 */
export function observe(expect, response) {
  const body = response.body ?? {};
  const observation = { status: response.status };
  const errorType = lookup(body, 'error.type');
  if (errorType !== MISSING) observation.error_type = errorType;
  if (lookup(body, 'hits.hits') !== MISSING) {
    observation.ids = hitIds(body);
    const total = totalOf(body);
    if (total !== MISSING) observation.total = total;
  }
  for (const name of Object.keys(expect?.aggregations ?? {})) {
    const buckets = bucketsOf(body, name);
    if (buckets !== MISSING) (observation.aggregations ??= {})[name] = buckets;
  }
  for (const name of Object.keys(expect?.suggest ?? {})) {
    const texts = suggestionTexts(body, name);
    if (texts !== MISSING) (observation.suggest ??= {})[name] = texts;
  }
  for (const path of Object.keys(expect?.body ?? {})) {
    const value = lookup(body, path);
    (observation.body ??= {})[path] = value === MISSING ? '(missing)' : value;
  }
  return observation;
}
