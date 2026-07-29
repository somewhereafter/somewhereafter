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
  const readme = renderReadme(snapshot.asOfDate, '<!-- token-graph:start -->\nold\n<!-- token-graph:end -->\n');
  assert.match(readme, /token-use\.svg\?v=2026-07-30-3/);
  assert.doesNotMatch(readme, /ca_read_|credential|almanac/i);
});

test('rewrites only the marked region and keeps the hand-written README', () => {
  const existing = [
    '<!-- token-graph:start -->',
    '<p align="center">stale graph</p>',
    '<!-- token-graph:end -->',
    '',
    '## Current projects',
    '',
    '- a project line worth keeping.',
    ''
  ].join('\n');

  const readme = renderReadme(snapshot.asOfDate, existing);
  assert.doesNotMatch(readme, /stale graph/);
  assert.match(readme, /## Current projects/);
  assert.match(readme, /- a project line worth keeping\./);
  assert.equal(readme.match(/token-graph:start/g).length, 1);
  assert.ok(readme.endsWith('- a project line worth keeping.\n'));
});

test('preserves existing content when the markers are missing', () => {
  const readme = renderReadme(snapshot.asOfDate, '## Current projects\n\n- keep me.\n');
  assert.match(readme, /token-graph:start/);
  assert.match(readme, /- keep me\./);
});
