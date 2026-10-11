// Side-by-side summary of several reports (one per engine), as Markdown.

import { isDeepStrictEqual } from 'node:util';
import { ENGINES } from './engines.mjs';
import { withoutRunId } from './runner.mjs';

const label = report => `${report.engine} ${report.identity.version}`;

function cell(entry) {
  if (!entry) return 'not run';
  const divergences = [...new Set(entry.steps.map(step => step.divergence).filter(Boolean))];
  return divergences.length ? `${entry.outcome} (${divergences.join(', ')})` : entry.outcome;
}

/** Whether all reference reports observed the same normalized responses for a case. */
function referencesAgree(caseId, references) {
  const observations = references
    .map(report => ({ report, entry: report.cases.find(item => item.id === caseId) }))
    .filter(({ entry }) => entry)
    .map(({ report, entry }) => withoutRunId(entry.steps.map(step => step.observed ?? null), report.run));
  if (observations.length < 2) return 'n/a';
  return observations.every(observation => isDeepStrictEqual(observation, observations[0])) ? 'yes' : '**no**';
}

const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const brief = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

export function summarize(reports) {
  const ordered = [...reports].sort((a, b) => Object.keys(ENGINES).indexOf(a.engine) - Object.keys(ENGINES).indexOf(b.engine));
  const references = ordered.filter(report => ENGINES[report.engine]?.reference);
  const ids = [];
  const groupOf = new Map();
  for (const report of ordered) {
    for (const entry of report.cases) {
      if (!groupOf.has(entry.id)) {
        ids.push(entry.id);
        groupOf.set(entry.id, entry.group);
      }
    }
  }

  const lines = ['# Reference harness summary', ''];
  lines.push('| Engine | Pass | Fail | Error |', '| --- | --- | --- | --- |');
  for (const report of ordered) {
    const { pass, fail, error } = report.summary;
    lines.push(`| ${label(report)} | ${pass} | ${fail} | ${error} |`);
  }
  lines.push('');

  const header = ['Group', 'Case', ...ordered.map(label), 'References agree'];
  lines.push(`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`);
  for (const id of ids) {
    const cells = ordered.map(report => cell(report.cases.find(entry => entry.id === id)));
    lines.push(`| ${groupOf.get(id)} | ${id} | ${cells.join(' | ')} | ${referencesAgree(id, references)} |`);
  }

  const problems = [];
  for (const report of ordered) {
    for (const entry of report.cases.filter(item => item.outcome !== 'pass')) {
      problems.push(`### ${label(report)}: ${entry.group}/${entry.id}`, '');
      entry.steps.forEach((step, i) => {
        if (step.outcome === 'pass') return;
        const target = `${step.request.method} ${withoutRunId(step.request.path, report.run)}`;
        if (step.error) {
          problems.push(`- step ${i + 1} \`${target}\`: error: ${escape(step.error)}`);
          return;
        }
        for (const check of step.checks.filter(item => !item.ok)) {
          problems.push(`- step ${i + 1} \`${target}\`: \`${check.name}\` expected \`${escape(brief(check.expected))}\`, observed \`${escape(brief(withoutRunId(check.observed ?? null, report.run)))}\``);
        }
      });
      problems.push('');
    }
  }
  if (problems.length) lines.push('', '## Failures', '', ...problems);
  return `${lines.join('\n').trimEnd()}\n`;
}
