// Placeholder substitution for case files: {{index}}, {{scratch}}, {{run}}.
//
// Placeholders are replaced in strings and in object keys (an index name can be
// a key in a response, for example `GET /{index}`). An unknown placeholder is an
// error rather than literal text, so a typo in a case fails loudly.

const PLACEHOLDER = /\{\{([a-z]+)\}\}/g;

export const PLACEHOLDERS = ['index', 'scratch', 'run'];

export function substitute(value, vars) {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (match, name) => {
      if (!(name in vars) || vars[name] == null) {
        throw new Error(`unknown or unset placeholder ${match}`);
      }
      return vars[name];
    });
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [substitute(key, vars), substitute(item, vars)])
    );
  }
  return value;
}

/** Placeholder names used anywhere in a value (strings and keys). */
export function placeholdersIn(value, found = new Set()) {
  if (typeof value === 'string') {
    for (const [, name] of value.matchAll(PLACEHOLDER)) found.add(name);
  } else if (Array.isArray(value)) {
    for (const item of value) placeholdersIn(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      placeholdersIn(key, found);
      placeholdersIn(item, found);
    }
  }
  return found;
}
