import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WINDOW_DAYS = 30;
const CACHE_REVISION = 4;
const GRAPH_START = '<!-- token-graph:start -->';
const GRAPH_END = '<!-- token-graph:end -->';

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
      `<path d="M${plot.x} ${pointY.toFixed(2)}H${plot.x + plot.width}" stroke="#16262b" stroke-width="1"/>`,
      `<text x="${plot.x - 18}" y="${(pointY + 4).toFixed(2)}" text-anchor="end">${escapeXml(compactNumber(value))}</text>`
    );
  }

  const verticalGrid = [0, 7, 14, 21, 29]
    .map((index) => `<path d="M${x(index).toFixed(2)} ${plot.y}V${plot.y + plot.height}" stroke="#101d21" stroke-width="1"/>`)
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
    <linearGradient id="spectral" gradientUnits="userSpaceOnUse" x1="${plot.x}" y1="0" x2="${plot.x + plot.width}" y2="0">
      <stop offset="0" stop-color="#9bffdc"/>
      <stop offset=".5" stop-color="#6ee7ff"/>
      <stop offset="1" stop-color="#b5a3ff"/>
    </linearGradient>
    <linearGradient id="wordmark" gradientUnits="userSpaceOnUse" x1="152" y1="70" x2="232" y2="100">
      <stop offset="0" stop-color="#9bffdc"/>
      <stop offset="1" stop-color="#6ee7ff"/>
    </linearGradient>
    <linearGradient id="seam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#9bffdc" stop-opacity="0"/>
      <stop offset=".18" stop-color="#9bffdc" stop-opacity=".85"/>
      <stop offset=".52" stop-color="#6ee7ff" stop-opacity=".5"/>
      <stop offset="1" stop-color="#b5a3ff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6ee7ff" stop-opacity=".22"/>
      <stop offset="1" stop-color="#6ee7ff" stop-opacity=".01"/>
    </linearGradient>
    <radialGradient id="sky" cx=".28" cy="0" r=".85">
      <stop offset="0" stop-color="#6ee7ff" stop-opacity=".12"/>
      <stop offset=".5" stop-color="#9bffdc" stop-opacity=".04"/>
      <stop offset="1" stop-color="#9bffdc" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="drift" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#b5a3ff" stop-opacity=".13"/>
      <stop offset="1" stop-color="#b5a3ff" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grain" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r=".6" fill="#dff6f1" fill-opacity=".05"/>
    </pattern>
    <filter id="signalGlow" x="-20%" y="-40%" width="140%" height="180%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="card">
      <rect width="${width}" height="${height}" rx="20"/>
    </clipPath>
  </defs>

  <g clip-path="url(#card)">
    <rect width="${width}" height="${height}" fill="#05080b"/>
    <rect width="${width}" height="${height}" fill="url(#grain)"/>
    <rect width="${width}" height="${height}" fill="url(#sky)"/>
    <ellipse cx="1080" cy="370" rx="360" ry="160" fill="url(#drift)"/>
    <rect width="${width}" height="1.5" fill="url(#seam)"/>
  </g>
  <rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="19.5" fill="none" stroke="#16262b"/>

  <rect x="64" y="37" width="24" height="2" rx="1" fill="#9bffdc"/>
  <text x="100" y="43" fill="#9bffdc" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace" font-size="11" letter-spacing="3.2">PERSONAL INSTRUMENT / 30D</text>
  <text x="1136" y="43" text-anchor="end" fill="#5f7173" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace" font-size="11" letter-spacing="2">UPDATED ${asOfDate}</text>

  <text x="62" y="95" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="40" font-weight="700" letter-spacing="-1.4">
    <tspan fill="#f2f7f6">token</tspan><tspan fill="url(#wordmark)"> use</tspan>
  </text>
  <text x="252" y="93" fill="#5f7173" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace" font-size="11" letter-spacing="2.2">CUMULATIVE / ALL SURFACES</text>
  <text x="1136" y="94" text-anchor="end" fill="#c7fff0" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace" font-size="17" font-weight="700" letter-spacing="1.2">${escapeXml(totalLabel)}</text>

  <g fill="#5f7173" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace" font-size="10" letter-spacing="1.2">
    ${horizontalGrid.join('')}
    ${dateLabels}
  </g>
  ${verticalGrid}

  <path d="${areaPath}" fill="url(#area)"/>
  <path d="${linePath}" fill="none" stroke="url(#spectral)" stroke-width="7" stroke-opacity=".2" filter="url(#signalGlow)"/>
  <path d="${linePath}" fill="none" stroke="url(#spectral)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>

  <path d="M${endX.toFixed(2)} ${plot.y}V${plot.y + plot.height}" stroke="#b5a3ff" stroke-width="1" stroke-dasharray="2 6" opacity=".55"/>
  <circle cx="${endX.toFixed(2)}" cy="${endY.toFixed(2)}" r="6" fill="#b5a3ff" fill-opacity=".18"/>
  <circle cx="${endX.toFixed(2)}" cy="${endY.toFixed(2)}" r="3.5" fill="#05080b" stroke="#b5a3ff" stroke-width="2"/>

  <g fill="#5f7173" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace" font-size="9" letter-spacing="1.5">
    <text x="60" y="198" transform="rotate(-90 60 198)" text-anchor="middle">CUMULATIVE TOKENS</text>
    <text x="1136" y="339" text-anchor="end">ROLLING WINDOW / DAILY REFRESH</text>
  </g>
</svg>
`;
}

export function renderGraphBlock(asOfDate) {
  const version = assertDateKey(asOfDate, 'snapshot.asOfDate');
  return `${GRAPH_START}
<p align="center">
  <img src="https://raw.githubusercontent.com/somewhereafter/somewhereafter/main/assets/token-use.svg?v=${version}-${CACHE_REVISION}" alt="Cumulative token use over the past 30 days" width="100%">
</p>
${GRAPH_END}`;
}

// Only the marked region is regenerated; everything else in the README is hand-written
// and must survive the daily refresh.
export function renderReadme(asOfDate, existing = '') {
  const block = renderGraphBlock(asOfDate);
  const start = existing.indexOf(GRAPH_START);
  const end = existing.indexOf(GRAPH_END);
  if (start === -1 || end === -1 || end < start) {
    return existing ? `${block}\n\n${existing.replace(/^\n+/, '')}` : `${block}\n`;
  }
  return existing.slice(0, start) + block + existing.slice(end + GRAPH_END.length);
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
