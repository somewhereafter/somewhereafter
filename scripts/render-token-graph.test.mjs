import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWindow, renderReadme, renderSnapshot } from './render-token-graph.mjs';

const snapshot = {
  asOfDate: '2026-07-30',
  daily: [
    { date: '2026-07-01', total: 10 },
    { date: '2026-07-15', total: 20 },
    { date: '2026-07-30', total: 30 }
  ]
};

test('builds a complete 30-day cumulative series', () => {
  const window = buildWindow(snapshot);
  assert.equal(window.length, 30);
  assert.equal(window[0].date, '2026-07-01');
  assert.equal(window[0].cumulative, 10);
  assert.equal(window[14].cumulative, 30);
  assert.equal(window[29].cumulative, 60);
});

test('renders one aggregate line without model details', () => {
  const svg = renderSnapshot(snapshot);
  assert.match(svg, /30-day cumulative token use/);
  assert.match(svg, /60 TOKENS/);
  assert.match(svg, /JUL 1/);
  assert.match(svg, /JUL 30/);
  assert.doesNotMatch(svg, /gpt-|model/i);
});

test('rejects invalid or negative daily totals', () => {
  assert.throws(
    () => buildWindow({ ...snapshot, daily: [{ date: '2026-07-30', total: -1 }] }),
    /non-negative/
  );
});

test('cache-busts the profile image once per Almanac day', () => {
  const readme = renderReadme(snapshot.asOfDate);
  assert.match(readme, /token-use\.svg\?v=2026-07-30-2/);
  assert.doesNotMatch(readme, /ca_read_|credential|almanac/i);
});

test('refreshes the graph block without touching the rest of the README', () => {
  const existing = [
    '<p align="center">',
    '  <img src="https://raw.githubusercontent.com/somewhereafter/somewhereafter/main/assets/token-use.svg?v=2026-01-01-2" alt="Cumulative token use over the past 30 days" width="100%">',
    '</p>',
    '',
    '## Current projects',
    '',
    '- [Something](https://example.com) — A description.',
    ''
  ].join('\n');

  const readme = renderReadme(snapshot.asOfDate, existing);
  assert.match(readme, /token-use\.svg\?v=2026-07-30-2/);
  assert.doesNotMatch(readme, /v=2026-01-01-2/);
  assert.match(readme, /## Current projects/);
  assert.match(readme, /- \[Something\]\(https:\/\/example\.com\) — A description\./);
  assert.equal(readme.match(/<p align="center">/g).length, 1);
});
