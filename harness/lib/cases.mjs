// Loading and validating case files (contracts/cases/*.json).
//
// Validation is strict on purpose: an unknown key is almost always a typo that
// would otherwise silently skip a check.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { EXPECT_KEYS, HITS_KEYS, PREDICATE_OPS } from './expect.mjs';
import { ENGINE_NAMES } from './engines.mjs';
import { parsePath } from './path.mjs';
import { PLACEHOLDERS, placeholdersIn } from './template.mjs';

const GROUP_KEYS = ['group', 'description', 'fixture', 'cases'];
const CASE_KEYS = ['id', 'capability', 'description', 'request', 'expect', 'engines', 'steps'];
const STEP_KEYS = ['description', 'request', 'expect', 'engines'];
const REQUEST_KEYS = ['method', 'path', 'query', 'body', 'ndjson'];
const METHODS = ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'];
const ID = /^[a-z0-9][a-z0-9-]*$/;

export async function loadJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

export async function loadGroups(casesDir) {
  const files = (await readdir(casesDir)).filter(name => name.endsWith('.json')).sort();
  const groups = [];
  for (const name of files) {
    const file = path.join(casesDir, name);
    groups.push({ file, ...(await loadJson(file)) });
  }
  return groups;
}

export async function loadDivergences(file) {
  try {
    const list = await loadJson(file);
    return new Map(list.map(entry => [entry.id, entry]));
  } catch (error) {
    if (error.message.includes('ENOENT')) return new Map();
    throw error;
  }
}

/** A case as a list of steps, whether written with `request` or `steps`. */
export function stepsOf(testCase) {
  if (testCase.steps) return testCase.steps;
  return [{ request: testCase.request, expect: testCase.expect, engines: testCase.engines }];
}

function unknownKeys(object, allowed, where, errors) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) errors.push(`${where}: unknown key "${key}"`);
  }
}

function validateExpect(expect, where, errors) {
  if (!expect || typeof expect !== 'object' || Array.isArray(expect)) {
    errors.push(`${where}: expect must be an object`);
    return;
  }
  unknownKeys(expect, EXPECT_KEYS, where, errors);
  if ('status' in expect && !Number.isInteger(expect.status)) errors.push(`${where}: status must be an integer`);
  if (expect.error && typeof expect.error.type !== 'string') errors.push(`${where}: error.type must be a string`);
  for (const p of [...Object.keys(expect.body ?? {}), ...(expect.shape ?? [])]) {
    try {
      parsePath(p);
    } catch (error) {
      errors.push(`${where}: ${error.message}`);
    }
  }
  if (expect.hits) {
    unknownKeys(expect.hits, HITS_KEYS, `${where}.hits`, errors);
    for (const predicate of expect.hits.every ?? []) {
      const ops = Object.keys(predicate).filter(key => key !== 'field' && key !== 'fields');
      if (ops.length !== 1 || !PREDICATE_OPS.includes(ops[0])) {
        errors.push(`${where}.hits.every: predicate needs exactly one of ${PREDICATE_OPS.join(', ')}`);
      }
      if (!predicate.field && !predicate.fields) errors.push(`${where}.hits.every: predicate needs field or fields`);
    }
  }
}

function validateStep(step, where, divergences, errors) {
  unknownKeys(step, STEP_KEYS, where, errors);
  const request = step.request;
  if (!request || typeof request !== 'object') {
    errors.push(`${where}: missing request`);
  } else {
    unknownKeys(request, REQUEST_KEYS, `${where}.request`, errors);
    if (!METHODS.includes(request.method)) errors.push(`${where}: method must be one of ${METHODS.join(', ')}`);
    if (typeof request.path !== 'string' || !request.path.startsWith('/')) errors.push(`${where}: path must start with /`);
    if ('body' in request && 'ndjson' in request) errors.push(`${where}: use body or ndjson, not both`);
    if ('ndjson' in request && !Array.isArray(request.ndjson)) errors.push(`${where}: ndjson must be an array`);
  }
  if (step.expect !== undefined) validateExpect(step.expect, `${where}.expect`, errors);
  for (const [engine, override] of Object.entries(step.engines ?? {})) {
    const at = `${where}.engines.${engine}`;
    if (!ENGINE_NAMES.includes(engine)) errors.push(`${at}: unknown engine`);
    unknownKeys(override, ['expect', 'divergence'], at, errors);
    if (!override.divergence) errors.push(`${at}: an engine override must cite a divergence`);
    else if (!divergences.has(override.divergence)) errors.push(`${at}: divergence ${override.divergence} is not recorded`);
    if (override.expect) validateExpect(override.expect, `${at}.expect`, errors);
  }
}

/** All problems in the loaded groups; an empty list means valid. */
export function validateGroups(groups, divergences, fixtureNames = []) {
  const errors = [];
  const seen = new Map();
  for (const group of groups) {
    const where = path.basename(group.file ?? group.group ?? '?');
    unknownKeys(Object.fromEntries(Object.entries(group).filter(([key]) => key !== 'file')), GROUP_KEYS, where, errors);
    if (typeof group.group !== 'string' || !ID.test(group.group)) errors.push(`${where}: group must be a lowercase id`);
    if (group.fixture != null && !fixtureNames.includes(group.fixture)) {
      errors.push(`${where}: unknown fixture "${group.fixture}"`);
    }
    if (!Array.isArray(group.cases) || group.cases.length === 0) {
      errors.push(`${where}: cases must be a non-empty array`);
      continue;
    }
    for (const testCase of group.cases) {
      const at = `${where}#${testCase.id ?? '?'}`;
      unknownKeys(testCase, CASE_KEYS, at, errors);
      if (typeof testCase.id !== 'string' || !ID.test(testCase.id)) errors.push(`${at}: id must be a lowercase id`);
      else if (seen.has(testCase.id)) errors.push(`${at}: duplicate id (also in ${seen.get(testCase.id)})`);
      else seen.set(testCase.id, where);
      if (typeof testCase.capability !== 'string') errors.push(`${at}: missing capability`);
      if (typeof testCase.description !== 'string') errors.push(`${at}: missing description`);
      const hasSteps = 'steps' in testCase;
      if (hasSteps && ('request' in testCase || 'expect' in testCase || 'engines' in testCase)) {
        errors.push(`${at}: use steps, or request/expect, not both`);
      }
      if (hasSteps && (!Array.isArray(testCase.steps) || testCase.steps.length === 0)) {
        errors.push(`${at}: steps must be a non-empty array`);
        continue;
      }
      if (!hasSteps && testCase.expect === undefined) errors.push(`${at}: a single-step case needs expect`);
      stepsOf(testCase).forEach((step, i) => validateStep(step, `${at} step ${i + 1}`, divergences, errors));
      for (const name of placeholdersIn(testCase)) {
        if (!PLACEHOLDERS.includes(name)) errors.push(`${at}: unknown placeholder {{${name}}}`);
        if (name === 'index' && group.fixture == null) errors.push(`${at}: {{index}} needs a group fixture`);
      }
    }
  }
  return errors;
}
