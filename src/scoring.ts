/**
 * Scores hourly weather for climb/ascent suitability.
 * Thresholds tuned for alpine rock/snow ascents.
 */

/** A single pressure-level slice of the model's vertical profile for one hour. */
export interface VerticalLevel {
  pressureHPa: number;          // 1000, 925, 850, 700, 600, 500
  geopotentialHeightM: number;  // height of this pressure surface, m
  tempC: number | null;
  windMs: number | null;
  windDir: number | null;       // degrees, meteorological FROM
  rh: number | null;            // %
}

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
  // Vertical pressure-level profile (Open-Meteo providers only); null/absent when
  // unavailable — scoring ignores it, analyze uses it for elevation interpolation.
  profile?: VerticalLevel[] | null;
}

export type Rating = "ideal" | "good" | "fair" | "marginal" | "avoid";

export interface ScoredHour extends HourData {
  score: number;          // 0-100, higher = better
  rating: Rating;
  reasons: string[];
}

export interface ClimbWindow {
  start: string;
  end: string;
  hours: number;
  score: number;
  rating: Rating;
  summary: string;
  reasons: string[];
}

function lerp(value: number, lo: number, hi: number, penLo: number, penHi: number): number {
  const t = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  return penLo + t * (penHi - penLo);
}

function penaltyWind(gust: number | null, reasons: string[]): number {
  if (gust == null) return 0;
  const fmt = `${gust.toFixed(0)}m/s`;
  if (gust >= 20) { reasons.push(`dangerous wind ${fmt}`); return 65; }
  if (gust >= 15) { const p = lerp(gust, 15, 20, 45, 65); reasons.push(`very strong wind ${fmt}`); return p; }
  if (gust >= 12) { const p = lerp(gust, 12, 15, 30, 45); reasons.push(`strong wind ${fmt}`); return p; }
  if (gust >= 8)  { const p = lerp(gust, 8, 12, 12, 30); reasons.push(`brisk wind ${fmt}`); return p; }
  return 0;
}

function penaltyPrecip(rr: number | null, reasons: string[]): number {
  if (rr == null) return 0;
  const fmt = `${rr.toFixed(1)}mm/h`;
  if (rr >= 2.0) { reasons.push(`extreme precip ${fmt}`); return 65; }
  if (rr >= 1.0) { const p = lerp(rr, 1.0, 2.0, 40, 65); reasons.push(`heavy precip ${fmt}`); return p; }
  if (rr >= 0.5) { const p = lerp(rr, 0.5, 1.0, 20, 40); reasons.push(`moderate precip ${fmt}`); return p; }
  if (rr >= 0.2) { const p = lerp(rr, 0.2, 0.5, 8, 20); reasons.push(`light precip ${fmt}`); return p; }
  return 0;
}

function penaltyCold(feelsLike: number | null, reasons: string[]): number {
  if (feelsLike == null) return 0;
  const fmt = `${feelsLike.toFixed(0)}°C`;
  if (feelsLike <= -15) { reasons.push(`very cold ${fmt}`); return 40; }
  if (feelsLike <= -10) { const p = lerp(-feelsLike, 10, 15, 25, 40); reasons.push(`cold ${fmt}`); return p; }
  if (feelsLike <= -5)  { const p = lerp(-feelsLike, 5, 10, 12, 25); reasons.push(`cold ${fmt}`); return p; }
  if (feelsLike >= 30)  { reasons.push(`hot ${fmt}`); return 15; }
  return 0;
}

function ratingFromScore(score: number): Rating {
  if (score >= 80) return "ideal";
  if (score >= 65) return "good";
  if (score >= 45) return "fair";
  if (score >= 30) return "marginal";
  return "avoid";
}

export function scoreHour(h: HourData): ScoredHour {
  let score = 100;
  const reasons: string[] = [];

  score -= penaltyWind(h.gust ?? h.wsp, reasons);
  score -= penaltyPrecip(h.rr, reasons);
  score -= penaltyCold(h.feelsLike ?? h.t2m, reasons);

  if (h.tcc != null && h.tcc >= 0.9 && (h.rr ?? 0) < 0.2) {
    score -= 5; reasons.push(`overcast ${(h.tcc * 100).toFixed(0)}%`);
  }

  if (h.snow != null && h.snow >= 0.3) {
    const p = h.snow >= 1.0 ? 30 : lerp(h.snow, 0.3, 1.0, 15, 30);
    score -= p; reasons.push(`snowfall ${h.snow.toFixed(1)}mm/h`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { ...h, score, rating: ratingFromScore(score), reasons };
}

/* ---- window-level scoring ---- */

interface WindowMetrics {
  maxGust: number;
  maxPrecipRate: number;
  totalPrecip: number;
  minFeelsLike: number;
  maxSnowRate: number;
  avgCloud: number;
  fractionAboveFreezing: number;
}

function extractMetrics(slice: ScoredHour[], summitElevation?: number | null): WindowMetrics {
  let maxGust = 0, maxPrecipRate = 0, totalPrecip = 0;
  let minFeelsLike = Infinity, maxSnowRate = 0;
  let cloudSum = 0, cloudCount = 0;
  let aboveFzCount = 0, fzTotal = 0;

  for (const h of slice) {
    const gust = h.gust ?? h.wsp ?? 0;
    if (gust > maxGust) maxGust = gust;
    const rr = h.rr ?? 0;
    if (rr > maxPrecipRate) maxPrecipRate = rr;
    totalPrecip += rr;
    const fl = h.feelsLike ?? h.t2m ?? 0;
    if (fl < minFeelsLike) minFeelsLike = fl;
    const snow = h.snow ?? 0;
    if (snow > maxSnowRate) maxSnowRate = snow;
    if (h.tcc != null) { cloudSum += h.tcc; cloudCount++; }
    if (summitElevation != null && h.freezingLevel != null) {
      fzTotal++;
      if (h.freezingLevel < summitElevation) aboveFzCount++;
    }
  }

  return {
    maxGust,
    maxPrecipRate,
    totalPrecip,
    minFeelsLike: minFeelsLike === Infinity ? 0 : minFeelsLike,
    maxSnowRate,
    avgCloud: cloudCount > 0 ? cloudSum / cloudCount : 0,
    fractionAboveFreezing: fzTotal > 0 ? aboveFzCount / fzTotal : 0,
  };
}

export function scoreWindow(slice: ScoredHour[], summitElevation?: number | null): { score: number; reasons: string[] } {
  const m = extractMetrics(slice, summitElevation);
  let score = 100;
  const reasons: string[] = [];
  let vetoed = false;

  // Hard veto
  if (m.maxGust >= 20) { vetoed = true; reasons.push(`dangerous gust ${m.maxGust.toFixed(0)}m/s`); }
  if (m.maxPrecipRate >= 2.0) { vetoed = true; reasons.push(`extreme precip ${m.maxPrecipRate.toFixed(1)}mm/h`); }

  // Wind (max gust)
  if (m.maxGust >= 15) { const p = lerp(m.maxGust, 15, 20, 40, 55); score -= p; reasons.push(`very strong gust ${m.maxGust.toFixed(0)}m/s`); }
  else if (m.maxGust >= 12) { const p = lerp(m.maxGust, 12, 15, 25, 40); score -= p; reasons.push(`strong gust ${m.maxGust.toFixed(0)}m/s`); }
  else if (m.maxGust >= 8) { const p = lerp(m.maxGust, 8, 12, 10, 25); score -= p; reasons.push(`brisk gust ${m.maxGust.toFixed(0)}m/s`); }

  // Precip rate (max)
  if (m.maxPrecipRate >= 1.0) { const p = lerp(m.maxPrecipRate, 1.0, 2.0, 35, 55); score -= p; reasons.push(`heavy precip ${m.maxPrecipRate.toFixed(1)}mm/h`); }
  else if (m.maxPrecipRate >= 0.5) { const p = lerp(m.maxPrecipRate, 0.5, 1.0, 15, 35); score -= p; reasons.push(`moderate precip ${m.maxPrecipRate.toFixed(1)}mm/h`); }
  else if (m.maxPrecipRate >= 0.2) { const p = lerp(m.maxPrecipRate, 0.2, 0.5, 5, 15); score -= p; reasons.push(`light precip ${m.maxPrecipRate.toFixed(1)}mm/h`); }

  // Precip total (stacks with rate)
  if (m.totalPrecip >= 5.0) { score -= 20; reasons.push(`${m.totalPrecip.toFixed(1)}mm total precip`); }
  else if (m.totalPrecip >= 2.0) { const p = lerp(m.totalPrecip, 2.0, 5.0, 8, 20); score -= p; reasons.push(`${m.totalPrecip.toFixed(1)}mm total precip`); }

  // Cold (min feels-like)
  if (m.minFeelsLike <= -15) { score -= 35; reasons.push(`very cold ${m.minFeelsLike.toFixed(0)}°C feels-like`); }
  else if (m.minFeelsLike <= -10) { const p = lerp(-m.minFeelsLike, 10, 15, 20, 35); score -= p; reasons.push(`cold ${m.minFeelsLike.toFixed(0)}°C feels-like`); }
  else if (m.minFeelsLike <= -5) { const p = lerp(-m.minFeelsLike, 5, 10, 10, 20); score -= p; reasons.push(`cold ${m.minFeelsLike.toFixed(0)}°C feels-like`); }

  // Snow rate
  if (m.maxSnowRate >= 1.0) { score -= 30; reasons.push(`heavy snow ${m.maxSnowRate.toFixed(1)}mm/h`); }
  else if (m.maxSnowRate >= 0.3) { const p = lerp(m.maxSnowRate, 0.3, 1.0, 15, 30); score -= p; reasons.push(`snow ${m.maxSnowRate.toFixed(1)}mm/h`); }

  // Cloud cover
  if (m.avgCloud >= 0.9) { score -= 8; reasons.push(`overcast ${Math.round(m.avgCloud * 100)}%`); }
  else if (m.avgCloud >= 0.75) { score -= 4; reasons.push(`cloudy ${Math.round(m.avgCloud * 100)}%`); }

  // Freezing level
  if (m.fractionAboveFreezing > 0.5) {
    const p = lerp(m.fractionAboveFreezing, 0.5, 1.0, 10, 20);
    score -= p;
    reasons.push(`summit above 0°C line ${Math.round(m.fractionAboveFreezing * 100)}% of window`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (vetoed && score > 30) score = 30;

  return { score, reasons };
}

/* ---- window finding ---- */

const WINDOW_START = 4;
const WINDOW_END = 14;
const MIN_HOURS = 4;
const MIN_WINDOW_SCORE = 30;

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

function buildDayWindow(dayHours: ScoredHour[], summitElevation?: number | null): ClimbWindow | null {
  const run = dayHours.filter(h => {
    const hr = new Date(h.time).getUTCHours();
    return hr >= WINDOW_START && hr < WINDOW_END;
  });
  if (run.length < MIN_HOURS) return null;

  while (run.length > MIN_HOURS && run[run.length - 1].score < 50) run.pop();

  const { score, reasons } = scoreWindow(run, summitElevation);
  if (score < MIN_WINDOW_SCORE) return null;

  const maxWind = Math.max(...run.map(h => h.gust ?? h.wsp ?? 0));
  const minT = Math.min(...run.map(h => h.t2m ?? 0));
  const maxT = Math.max(...run.map(h => h.t2m ?? 0));

  return {
    start: run[0].time,
    end: run[run.length - 1].time,
    hours: run.length,
    score,
    rating: ratingFromScore(score),
    summary: `wind ≤${maxWind.toFixed(0)}m/s, ${minT.toFixed(0)}…${maxT.toFixed(0)}°C`,
    reasons,
  };
}

export function findWindows(scored: ScoredHour[], summitElevation?: number | null): ClimbWindow[] {
  if (!scored.length) return [];

  const windows: ClimbWindow[] = [];
  for (const dayHours of groupByDay(scored)) {
    const w = buildDayWindow(dayHours, summitElevation);
    if (w) windows.push(w);
  }
  return windows.sort((a, b) => b.score - a.score);
}
