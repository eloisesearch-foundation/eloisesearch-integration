// Path lookup in JSON responses.
//
//   "result"                 a top-level field
//   "_shards.failed"         nested fields
//   "items[0].index.status"  an array element
//   "hits.hits[]._id"        every element of an array
//
// Field names cannot contain dots; response fields that do (rare in the
// subset) are reached through their parent object instead.

export const MISSING = Symbol('missing');

export function parsePath(path) {
  const tokens = [];
  for (const part of path.split('.')) {
    const match = /^([^[\]]*)((?:\[\d*\])*)$/.exec(part);
    if (!match || (!match[1] && !match[2])) throw new Error(`invalid path "${path}"`);
    if (match[1]) tokens.push(match[1]);
    for (const [, index] of match[2].matchAll(/\[(\d*)\]/g)) {
      tokens.push(index === '' ? '[]' : Number(index));
    }
  }
  if (tokens.length === 0) throw new Error(`invalid path "${path}"`);
  return tokens;
}

/**
 * Values at a path. Without `[]` the result has one entry (possibly MISSING);
 * with `[]` it has one entry per array element, and is empty for an empty array.
 * A `[]` over something that is not an array yields a single MISSING.
 */
export function lookupAll(value, path) {
  let current = [value];
  for (const token of parsePath(path)) {
    const next = [];
    for (const item of current) {
      if (item === MISSING) {
        next.push(MISSING);
      } else if (token === '[]') {
        if (Array.isArray(item)) next.push(...item);
        else next.push(MISSING);
      } else if (typeof token === 'number') {
        next.push(Array.isArray(item) && token < item.length ? item[token] : MISSING);
      } else {
        next.push(item && typeof item === 'object' && !Array.isArray(item) && Object.hasOwn(item, token)
          ? item[token]
          : MISSING);
      }
    }
    current = next;
  }
  return current;
}

/** The single value at a path without `[]`, or MISSING. */
export function lookup(value, path) {
  const values = lookupAll(value, path);
  if (values.length !== 1) throw new Error(`path "${path}" is not a single value`);
  return values[0];
}
