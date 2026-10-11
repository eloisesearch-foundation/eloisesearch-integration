// Repository locations used by the harness commands.

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const paths = {
  root,
  cases: path.join(root, 'contracts', 'cases'),
  fixtures: path.join(root, 'contracts', 'fixtures'),
  divergences: path.join(root, 'contracts', 'divergences.json'),
  reports: path.join(root, 'reports'),
};

export async function fixtureNames(dir = paths.fixtures) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch {
    return [];
  }
}
