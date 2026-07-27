import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WINDOW_DAYS = 30;
const CACHE_REVISION = 2;

function assertDateKey(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid date`);
  }
  return value;
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

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

function compactNumber(value) {
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K']
  ];
  for (const [size, suffix] of units) {
    if (Math.abs(value) >= size) {
      const scaled = value / size;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${trimFixed(scaled, digits)}${suffix}`;
    }
  }
  return Math.round(value).toLocaleString('en-US');
}

function readableDate(dateKey) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${dateKey}T00:00:00Z`)).toUpperCase();
}

function niceStep(maximum) {
  if (maximum <= 0) return 1;
  const rough = maximum / 4;
  const exponent = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * exponent;
}

export function buildWindow(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.daily)) {
    throw new Error('Almanac snapshot is missing daily totals');
  }

  const asOfDate = assertDateKey(snapshot.asOfDate, 'snapshot.asOfDate');
  const totals = new Map();
  for (const record of snapshot.daily) {
    const date = assertDateKey(record?.date, 'daily record date');
    const total = Number(record?.total);
    if (!Number.isFinite(total) || total < 0) {
      throw new Error(`daily total for ${date} must be a non-negative number`);
    }
    totals.set(date, (totals.get(date) ?? 0) + total);
  }

  let cumulative = 0;
  return Array.from({ length: WINDOW_DAYS }, (_, index) => {
    const date = addDays(asOfDate, index - (WINDOW_DAYS - 1));
    const daily = totals.get(date) ?? 0;
    cumulative += daily;
    return { date, daily, cumulative };
  });
}

export function renderSnapshot(snapshot) {
  const window = buildWindow(snapshot);
  const width = 1200;
  const height = 360;
  const plot = { x: 124, y: 112, width: 1012, height: 172 };
  const total = window.at(-1).cumulative;
  const step = niceStep(total * 1.08);
  const ceiling = Math.max(step, Math.ceil((total * 1.08) / step) * step);
  const x = (index) => plot.x + (index / (WINDOW_DAYS - 1)) * plot.width;
  const y = (value) => plot.y + plot.height - (value / ceiling) * plot.height;

  const points = window.map((record, index) => [x(index), y(record.cumulative)]);
  const linePath = points
    .map(([pointX, pointY], index) => `${index === 0 ? 'M' : 'L'}${pointX.toFixed(2)} ${pointY.toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L${(plot.x + plot.width).toFixed(2)} ${(plot.y + plot.height).toFixed(2)} L${plot.x} ${(plot.y + plot.height).toFixed(2)} Z`;

  const horizontalGrid = [];
  for (let value = 0; value <= ceiling + step / 2; value += step) {
    const pointY = y(value);
    horizontalGrid.push(
      `<path d="M${plot.x} ${pointY.toFixed(2)}H${plot.x + plot.width}" stroke="#263536" stroke-width="1"/>`,
      `<text x="${plot.x - 18}" y="${(pointY + 4).toFixed(2)}" text-anchor="end">${escapeXml(compactNumber(value))}</text>`
    );
  }

  const verticalGrid = [0, 7, 14, 21, 29]
    .map((index) => `<path d="M${x(index).toFixed(2)} ${plot.y}V${plot.y + plot.height}" stroke="#1c282a" stroke-width="1"/>`)
    .join('');

  const dateLabels = [0, 14, 29]
    .map((index) => {
      const anchor = index === 0 ? 'start' : index === 29 ? 'end' : 'middle';
      return `<text x="${x(index).toFixed(2)}" y="311" text-anchor="${anchor}">${escapeXml(readableDate(window[index].date))}</text>`;
    })
    .join('');

  const [endX, endY] = points.at(-1);
  const asOfDate = window.at(-1).date;
  const totalLabel = `${compactNumber(total)} TOKENS`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">30-day cumulative token use</title>
  <desc id="description">${escapeXml(`Cumulative token use from ${window[0].date} through ${asOfDate}, totaling ${Math.round(total).toLocaleString('en-US')} tokens.`)}</desc>
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="#223035" stroke-width="1"/>
    </pattern>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <path d="M0 .5H4" stroke="#d8ceba" stroke-opacity=".018"/>
    </pattern>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#538788" stop-opacity=".28"/>
      <stop offset="1" stop-color="#538788" stop-opacity=".015"/>
    </linearGradient>
    <filter id="signalGlow" x="-20%" y="-40%" width="140%" height="180%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" fill="#070909"/>
  <rect width="${width}" height="${height}" fill="url(#grid)" opacity=".13"/>
  <rect width="${width}" height="${height}" fill="url(#scan)"/>
  <rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#263536"/>

  <g fill="#6f7d7b" font-family="Consolas, ui-monospace, monospace" font-size="11" letter-spacing="2">
    <text x="64" y="42">PERSONAL INSTRUMENT / 30D</text>
    <text x="1136" y="42" text-anchor="end">UPDATED ${asOfDate}</text>
  </g>

  <text x="60" y="91" fill="#d8ceba" font-family="Georgia, 'Times New Roman', serif" font-size="39" font-style="italic">token use</text>
  <text x="276" y="88" fill="#859290" font-family="Consolas, ui-monospace, monospace" font-size="11" letter-spacing="1.8">CUMULATIVE / ALL SURFACES</text>
  <text x="1136" y="89" text-anchor="end" fill="#d8ceba" font-family="Consolas, ui-monospace, monospace" font-size="16" letter-spacing="1.2">${escapeXml(totalLabel)}</text>

  <g fill="#647371" font-family="Consolas, ui-monospace, monospace" font-size="10" letter-spacing="1.2">
    ${horizontalGrid.join('')}
    ${dateLabels}
  </g>
  ${verticalGrid}

  <path d="${areaPath}" fill="url(#area)"/>
  <path d="${linePath}" fill="none" stroke="#315d61" stroke-width="7" stroke-opacity=".24" filter="url(#signalGlow)"/>
  <path d="${linePath}" fill="none" stroke="#d8ceba" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter"/>

  <path d="M${endX.toFixed(2)} ${plot.y}V${plot.y + plot.height}" stroke="#538788" stroke-width="1" stroke-dasharray="2 6" opacity=".9"/>
  <circle cx="${endX.toFixed(2)}" cy="${endY.toFixed(2)}" r="5.5" fill="#070909" stroke="#d8ceba" stroke-width="2"/>
  <rect x="${(endX - 2).toFixed(2)}" y="${(endY - 2).toFixed(2)}" width="4" height="4" fill="#538788"/>

  <g fill="#647371" font-family="Consolas, ui-monospace, monospace" font-size="9" letter-spacing="1.5">
    <text x="64" y="198" transform="rotate(-90 64 198)" text-anchor="middle">CUMULATIVE TOKENS</text>
    <text x="1136" y="339" text-anchor="end">ROLLING WINDOW / DAILY REFRESH</text>
  </g>
</svg>
`;
}

// The graph block is generated; everything after it is hand-written and must
// survive a refresh, so only the leading <p align="center"> block is replaced.
export function renderReadme(asOfDate, existingReadme = '') {
  const version = assertDateKey(asOfDate, 'snapshot.asOfDate');
  const graph = `<p align="center">
  <img src="https://raw.githubusercontent.com/somewhereafter/somewhereafter/main/assets/token-use.svg?v=${version}-${CACHE_REVISION}" alt="Cumulative token use over the past 30 days" width="100%">
</p>
`;
  const body = existingReadme.replace(/^<p align="center">[\s\S]*?<\/p>\n/, '');
  return body.trim() ? `${graph}\n${body.replace(/^\n+/, '')}` : graph;
}

async function loadSnapshot() {
  if (process.env.SNAPSHOT_FILE) {
    return JSON.parse(await readFile(resolve(process.env.SNAPSHOT_FILE), 'utf8'));
  }

  const token = process.env.ALMANAC_READ_TOKEN;
  if (!token) throw new Error('ALMANAC_READ_TOKEN is required');
  const configuredOrigin = process.env.ALMANAC_ORIGIN;
  if (!configuredOrigin) throw new Error('ALMANAC_ORIGIN is required');
  const origin = configuredOrigin.replace(/\/+$/, '');
  const response = await fetch(`${origin}/api/v1/snapshot`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw new Error(`Almanac snapshot request failed with HTTP ${response.status}`);
  }
  return response.json();
}

export async function main() {
  const snapshot = await loadSnapshot();
  const output = resolve(process.env.GRAPH_OUTPUT || 'assets/token-use.svg');
  const readmeOutput = resolve(process.env.README_OUTPUT || 'README.md');
  const existingReadme = await readFile(readmeOutput, 'utf8').catch(() => '');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderSnapshot(snapshot), 'utf8');
  await writeFile(readmeOutput, renderReadme(snapshot.asOfDate, existingReadme), 'utf8');
  process.stdout.write(`rendered ${output} and refreshed ${readmeOutput}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
