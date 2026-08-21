import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TOP_N = 9;
const CACHE_REVISION = 1;
const BLOCK_START = '<!-- languages:start -->';
const BLOCK_END = '<!-- languages:end -->';

// Kept identical to the token graph so the two cards read as one instrument set.
const INK = '#05080b';
const FRAME = '#16262b';
const MUTED = '#5f7173';
const BRIGHT = '#f2f7f6';
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const DISPLAY = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function trimFixed(value, digits) {
  return value.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');
}

export function formatBytes(value) {
  const units = [
    [1e9, 'GB'],
    [1e6, 'MB'],
    [1e3, 'KB']
  ];
  for (const [size, suffix] of units) {
    if (value >= size) {
      const scaled = value / size;
      return `${trimFixed(scaled, scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)} ${suffix}`;
    }
  }
  return `${Math.round(value)} B`;
}

// Collapse per-repository language edges into one ranked table. Anything past
// TOP_N becomes a single "Other" slice so the proportions still sum to 100%.
export function summarise(repositories, topN = TOP_N) {
  const totals = new Map();
  for (const repo of repositories ?? []) {
    for (const edge of repo?.languages?.edges ?? []) {
      const name = edge?.node?.name;
      const size = Number(edge?.size ?? 0);
      if (!name || !Number.isFinite(size) || size <= 0) continue;
      const previous = totals.get(name);
      if (previous) previous.bytes += size;
      else totals.set(name, { name, bytes: size, color: edge.node.color || '#8b9cb3' });
    }
  }

  const ranked = [...totals.values()].sort((a, b) => b.bytes - a.bytes);
  const total = ranked.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total === 0) throw new Error('No language bytes found across repositories');

  const head = ranked.slice(0, topN);
  const tail = ranked.slice(topN);
  if (tail.length) {
    head.push({
      name: 'Other',
      bytes: tail.reduce((sum, entry) => sum + entry.bytes, 0),
      color: '#3d4f5c'
    });
  }
  return {
    total,
    distinctCount: ranked.length,
    languages: head.map((entry) => ({ ...entry, share: entry.bytes / total }))
  };
}

export function renderCard(summary, asOfDate) {
  const width = 1200;
  const height = 360;
  const left = 62;
  const right = 1138;
  const span = right - left;

  // Proportional bar. Tiny slices still get a visible sliver, and the rounded
  // ends come from a clip so segments stay exactly proportional.
  const MIN = 3;
  const raw = summary.languages.map((l) => l.share * span);
  const lifted = raw.map((w) => Math.max(w, MIN));
  const overflow = lifted.reduce((a, b) => a + b, 0) - span;
  const slack = lifted.reduce((sum, w, i) => sum + (raw[i] > MIN ? w - MIN : 0), 0);
  let cursor = left;
  const segments = summary.languages.map((lang, index) => {
    let w = lifted[index];
    if (overflow > 0 && slack > 0 && raw[index] > MIN) {
      w -= overflow * ((w - MIN) / slack);
    }
    const x = cursor;
    cursor += w;
    return `<rect x="${x.toFixed(2)}" y="150" width="${Math.max(w, 0.6).toFixed(2)}" height="20" fill="${lang.color}"/>`;
  });

  // Legend: five columns, two rows. Name, share, then absolute size.
  const columns = 5;
  const columnWidth = span / columns;
  const legend = summary.languages.slice(0, columns * 2).map((lang, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = left + col * columnWidth;
    const y = 222 + row * 74;
    const pct = lang.share * 100;
    const pctLabel = pct >= 10 ? `${pct.toFixed(1)}%` : `${pct.toFixed(2)}%`;
    return `  <g>
    <rect x="${x.toFixed(1)}" y="${y - 10}" width="10" height="10" rx="2.5" fill="${lang.color}"/>
    <text x="${(x + 18).toFixed(1)}" y="${y}" fill="${BRIGHT}" font-family="${MONO}" font-size="12.5" letter-spacing="0.4">${escapeXml(lang.name)}</text>
    <text x="${x.toFixed(1)}" y="${y + 30}" fill="${lang.color}" font-family="${DISPLAY}" font-size="26" font-weight="700" letter-spacing="-0.8">${pctLabel}</text>
    <text x="${x.toFixed(1)}" y="${y + 48}" fill="${MUTED}" font-family="${MONO}" font-size="10" letter-spacing="1.4">${escapeXml(formatBytes(lang.bytes).toUpperCase())}</text>
  </g>`;
  });

  const totalLabel = formatBytes(summary.total).toUpperCase();
  const languageCount = summary.distinctCount ?? summary.languages.length;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">Language mix across all repositories</title>
  <desc id="description">${escapeXml(
    summary.languages
      .slice(0, 5)
      .map((l) => `${l.name} ${trimFixed(l.share * 100, 1)}%`)
      .join(', ')
  )}, totalling ${escapeXml(totalLabel)} of source.</desc>
  <defs>
    <linearGradient id="wordmark" gradientUnits="userSpaceOnUse" x1="62" y1="0" x2="420" y2="0">
      <stop offset="0" stop-color="#9bffdc"/>
      <stop offset=".5" stop-color="#6ee7ff"/>
      <stop offset="1" stop-color="#b5a3ff"/>
    </linearGradient>
    <pattern id="grain" width="2" height="2" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r=".6" fill="#dff6f1" fill-opacity=".05"/>
    </pattern>
    <clipPath id="barClip"><rect x="${left}" y="150" width="${span}" height="20" rx="10"/></clipPath>
  </defs>

  <rect width="${width}" height="${height}" fill="${INK}"/>
  <rect width="${width}" height="${height}" fill="url(#grain)"/>
  <rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="19.5" fill="none" stroke="${FRAME}"/>

  <rect x="64" y="37" width="24" height="2" rx="1" fill="#9bffdc"/>
  <text x="100" y="43" fill="#9bffdc" font-family="${MONO}" font-size="11" letter-spacing="3.2">PERSONAL INSTRUMENT / LANGUAGES</text>
  <text x="1136" y="43" text-anchor="end" fill="${MUTED}" font-family="${MONO}" font-size="11" letter-spacing="2">UPDATED ${escapeXml(asOfDate)}</text>

  <text x="62" y="95" font-family="${DISPLAY}" font-size="40" font-weight="700" letter-spacing="-1.4">
    <tspan fill="${BRIGHT}">code</tspan><tspan fill="url(#wordmark)"> mix</tspan>
  </text>
  <text x="252" y="93" fill="${MUTED}" font-family="${MONO}" font-size="11" letter-spacing="2.2">BY BYTES / ALL REPOSITORIES</text>
  <text x="1136" y="94" text-anchor="end" fill="#c7fff0" font-family="${MONO}" font-size="17" font-weight="700" letter-spacing="1.2">${escapeXml(totalLabel)}</text>
  <text x="1136" y="112" text-anchor="end" fill="${MUTED}" font-family="${MONO}" font-size="10" letter-spacing="1.6">${languageCount} LANGUAGES</text>

  <g clip-path="url(#barClip)">
${segments.map((s) => `    ${s}`).join('\n')}
  </g>
  <rect x="${left}" y="150" width="${span}" height="20" rx="10" fill="none" stroke="${FRAME}" stroke-opacity=".8"/>

${legend.join('\n')}
</svg>
`;
}

export function renderBlock(asOfDate) {
  return `${BLOCK_START}
<p align="center">
  <img src="https://raw.githubusercontent.com/somewhereafter/somewhereafter/main/assets/languages.svg?v=${asOfDate}-${CACHE_REVISION}" alt="Language mix across all repositories" width="100%">
</p>
${BLOCK_END}`;
}

// Only the marked region is regenerated; the rest of the README is hand-written.
export function renderReadme(asOfDate, existing = '') {
  const block = renderBlock(asOfDate);
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return null;
  return existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length);
}

const QUERY = `
query($cursor: String) {
  viewer {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        languages(first: 25, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const { stdout } = await execFileAsync('gh', ['auth', 'token']);
  return stdout.trim();
}

async function loadRepositories() {
  if (process.env.LANGUAGES_FILE) {
    return JSON.parse(await readFile(resolve(process.env.LANGUAGES_FILE), 'utf8'));
  }
  const token = await resolveToken();
  if (!token) throw new Error('GITHUB_TOKEN is required, or `gh auth login`');

  const repositories = [];
  let cursor = null;
  for (;;) {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors[0].message);
    const page = payload.data.viewer.repositories;
    repositories.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return repositories;
}

export async function main() {
  const repositories = await loadRepositories();
  const summary = summarise(repositories);
  const asOfDate = new Date().toISOString().slice(0, 10);

  const output = resolve(process.env.LANGUAGES_OUTPUT || 'assets/languages.svg');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderCard(summary, asOfDate), 'utf8');

  const readmeOutput = resolve(process.env.README_OUTPUT || 'README.md');
  const existing = await readFile(readmeOutput, 'utf8').catch(() => '');
  const next = renderReadme(asOfDate, existing);
  if (next === null) {
    process.stdout.write(`rendered ${output} (README has no ${BLOCK_START} marker; left untouched)\n`);
    return;
  }
  await writeFile(readmeOutput, next, 'utf8');
  process.stdout.write(`rendered ${output} across ${repositories.length} repositories\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
