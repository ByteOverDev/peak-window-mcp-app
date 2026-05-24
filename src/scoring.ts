/**
 * Scores hourly weather for climb/ascent suitability.
 * Thresholds tuned for alpine rock/snow ascents.
 */

export interface HourData {
  time: string;
  t2m: number | null;       // 2m air temperature, °C
  rr: number | null;        // precipitation, mm/h
  wsp: number | null;       // 10m wind speed, m/s
  gust: number | null;      // 10m wind gust, m/s
  tcc: number | null;       // total cloud cover, 0-1 fraction
  snow: number | null;      // snowfall mm/h (water-equivalent)
  snowlmt: number | null;   // snow line / freezing level, meters
  dd: number | null;        // wind direction, degrees (meteorological: FROM)
  feelsLike: number | null; // wind chill temperature, °C
  freezingLevel: number | null; // 0°C isotherm elevation, meters
  precipType: "none" | "rain" | "snow" | "mixed"; // derived from snowlmt vs summit
}

export interface ScoredHour extends HourData {
  score: number;          // 0-100, higher = better
  rating: "ideal" | "good" | "marginal" | "avoid";
  reasons: string[];
}

export interface ClimbWindow {
  start: string;
  end: string;
  hours: number;
  avgScore: number;
  rating: ScoredHour["rating"];
  summary: string;
}

type Threshold = readonly [number, number, string];

// Descending thresholds: first match wins (value >= threshold → penalty).
const PRECIP_THRESHOLDS: Threshold[] = [
  [1.0, 60, "heavy precip"],
  [0.2, 25, "light precip"],
];

const WIND_THRESHOLDS: Threshold[] = [
  [20, 60, "dangerous wind"],
  [15, 45, "very strong wind"],
  [12, 35, "strong wind"],
  [8,  20, "brisk wind"],
];

// Cold thresholds use <=, so sorted ascending (most severe first).
const COLD_THRESHOLDS: Threshold[] = [
  [-15, 40, "very cold"],
  [-10, 25, "cold"],
  [-5,  15, "cold"],
];

function applyThreshold(
  value: number | null, thresholds: Threshold[],
  fmt: (v: number) => string, reasons: string[],
): number {
  if (value == null) return 0;
  for (const [limit, penalty, label] of thresholds) {
    if (value >= limit) { reasons.push(`${label} ${fmt(value)}`); return penalty; }
  }
  return 0;
}

function applyColdThreshold(
  value: number | null, thresholds: Threshold[],
  fmt: (v: number) => string, reasons: string[],
): number {
  if (value == null) return 0;
  for (const [limit, penalty, label] of thresholds) {
    if (value <= limit) { reasons.push(`${label} ${fmt(value)}`); return penalty; }
  }
  if (value >= 30) { reasons.push(`hot ${fmt(value)}`); return 15; }
  return 0;
}

function ratingFromScore(score: number): ScoredHour["rating"] {
  if (score >= 80) return "ideal";
  if (score >= 60) return "good";
  if (score >= 35) return "marginal";
  return "avoid";
}

export function scoreHour(h: HourData): ScoredHour {
  let score = 100;
  const reasons: string[] = [];
  const fmtMm = (v: number) => `${v.toFixed(1)}mm/h`;
  const fmtMs = (v: number) => `${v.toFixed(0)}m/s`;
  const fmtC = (v: number) => `${v.toFixed(0)}°C`;

  score -= applyThreshold(h.rr, PRECIP_THRESHOLDS, fmtMm, reasons);
  score -= applyThreshold(h.gust ?? h.wsp, WIND_THRESHOLDS, fmtMs, reasons);
  score -= applyColdThreshold(h.t2m, COLD_THRESHOLDS, fmtC, reasons);

  if (h.tcc != null && h.tcc >= 90 && (h.rr ?? 0) < 0.2) {
    score -= 5; reasons.push(`overcast ${h.tcc.toFixed(0)}%`);
  }

  if (h.snow != null && h.snow >= 0.3) {
    score -= 30; reasons.push(`snowfall ${h.snow.toFixed(1)}mm/h`);
  }

  score = Math.max(0, Math.min(100, score));
  return { ...h, score, rating: ratingFromScore(score), reasons };
}

/**
 * Find the best morning start per day for an alpine summit push.
 *
 * For each day, scores a 6-hour morning block (04:00-10:00 local) which
 * covers the realistic summit window for most Austrian alpine routes.
 * The climber decides actual duration from the hourly detail.
 */
const WINDOW_START = 4;
const WINDOW_END = 14;
const MIN_HOURS = 4;
const MIN_AVG_SCORE = 50;

function groupByDay(scored: ScoredHour[]): ScoredHour[][] {
  const dayMap = new Map<string, ScoredHour[]>();
  for (const h of scored) {
    const d = new Date(h.time);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
    let group = dayMap.get(key);
    if (!group) { group = []; dayMap.set(key, group); }
    group.push(h);
  }
  return Array.from(dayMap.values());
}

function buildDayWindow(dayHours: ScoredHour[]): ClimbWindow | null {
  const run = dayHours.filter(h => {
    const hr = new Date(h.time).getUTCHours();
    return hr >= WINDOW_START && hr < WINDOW_END;
  });
  if (run.length < MIN_HOURS) return null;

  while (run.length > MIN_HOURS && run[run.length - 1].score < 50) run.pop();

  const avg = run.reduce((s, h) => s + h.score, 0) / run.length;
  if (avg < MIN_AVG_SCORE) return null;

  const maxWind = Math.max(...run.map(h => h.gust ?? h.wsp ?? 0));
  const minT = Math.min(...run.map(h => h.t2m ?? 0));
  const maxT = Math.max(...run.map(h => h.t2m ?? 0));

  return {
    start: run[0].time,
    end: run[run.length - 1].time,
    hours: run.length,
    avgScore: Math.round(avg),
    rating: ratingFromScore(avg),
    summary: `wind ≤${maxWind.toFixed(0)}m/s, ${minT.toFixed(0)}…${maxT.toFixed(0)}°C`,
  };
}

export function findWindows(scored: ScoredHour[]): ClimbWindow[] {
  if (!scored.length) return [];

  const windows: ClimbWindow[] = [];
  for (const dayHours of groupByDay(scored)) {
    const w = buildDayWindow(dayHours);
    if (w) windows.push(w);
  }
  return windows.sort((a, b) => b.avgScore - a.avgScore);
}
