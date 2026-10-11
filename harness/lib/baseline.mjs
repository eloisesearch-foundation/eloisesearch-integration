// Baselines: the normalized observations of a reviewed reference run.
//
// A baseline holds no timestamps, run ids or generated values, so running the
// same version again produces the same file, and a reference upgrade shows up
// as a plain diff of what moved.

import { withoutRunId } from './runner.mjs';

export function baselineOf(report) {
  const { pass, fail, error } = report.summary;
  if (fail > 0 || error > 0) {
    throw new Error(`${report.engine} ${report.identity.version}: ${fail} failed and ${error} errors; only a clean run becomes a baseline`);
  }
  const cases = {};
  for (const entry of [...report.cases].sort((a, b) => `${a.group}/${a.id}`.localeCompare(`${b.group}/${b.id}`))) {
    cases[`${entry.group}/${entry.id}`] = withoutRunId(entry.steps.map(step => step.observed ?? null), report.run);
  }
  return {
    format: report.format,
    engine: report.engine,
    version: report.identity.version,
    cases_passed: pass,
    cases,
  };
}
