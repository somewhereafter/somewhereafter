import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBytes, renderCard, summarise } from './render-languages.mjs';

const repositories = [
  {
    name: 'a',
    languages: { edges: [
      { size: 600, node: { name: 'Rust', color: '#dea584' } },
      { size: 300, node: { name: 'Go', color: '#00ADD8' } }
    ] }
  },
  {
    name: 'b',
    languages: { edges: [
      { size: 100, node: { name: 'Rust', color: '#dea584' } }
    ] }
  }
];

test('sums the same language across repositories', () => {
  const summary = summarise(repositories);
  assert.equal(summary.total, 1000);
  assert.equal(summary.languages[0].name, 'Rust');
  assert.equal(summary.languages[0].bytes, 700);
  assert.equal(summary.languages[0].share, 0.7);
});

test('shares always sum to one', () => {
  const summary = summarise(repositories);
  const sum = summary.languages.reduce((total, entry) => total + entry.share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('collapses the tail into Other and still counts every language', () => {
  const many = [{
    name: 'big',
    languages: { edges: Array.from({ length: 14 }, (_, index) => ({
      size: 1000 - index * 10,
      node: { name: `L${index}`, color: '#123456' }
    })) }
  }];
  const summary = summarise(many, 9);
  assert.equal(summary.languages.length, 10);
  assert.equal(summary.languages.at(-1).name, 'Other');
  assert.equal(summary.distinctCount, 14);
  const sum = summary.languages.reduce((total, entry) => total + entry.share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('rejects an empty corpus rather than dividing by zero', () => {
  assert.throws(() => summarise([]), /No language bytes/);
});

test('formats byte magnitudes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(48_600), '48.6 KB');
  assert.equal(formatBytes(3_733_885), '3.73 MB');
});

test('renders well-formed svg carrying the real colours', () => {
  const svg = renderCard(summarise(repositories), '2026-08-21');
  assert.match(svg, /^<svg xmlns/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.match(svg, /#dea584/);
  assert.match(svg, /UPDATED 2026-08-21/);
  // Bar segments must never spill past the card's right edge.
  const widths = [...svg.matchAll(/<rect x="([\d.]+)" y="150" width="([\d.]+)"/g)];
  assert.ok(widths.length > 0);
  for (const [, x, w] of widths) assert.ok(Number(x) + Number(w) <= 1138.5);
});
