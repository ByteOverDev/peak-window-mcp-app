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

export function scoreHour(h: HourData): ScoredHour {
  let score = 100;
  const reasons: string[] = [];

  if (h.rr !== null) {
    if (h.rr >= 1.0) { score -= 60; reasons.push(`heavy precip ${h.rr.toFixed(1)}mm/h`); }
    else if (h.rr >= 0.2) { score -= 25; reasons.push(`light precip ${h.rr.toFixed(1)}mm/h`); }
  }

  const wind = h.gust ?? h.wsp;
  if (wind !== null) {
    if (wind >= 20) { score -= 60; reasons.push(`dangerous wind ${wind.toFixed(0)}m/s`); }
    else if (wind >= 15) { score -= 45; reasons.push(`very strong wind ${wind.toFixed(0)}m/s`); }
    else if (wind >= 12) { score -= 35; reasons.push(`strong wind ${wind.toFixed(0)}m/s`); }
    else if (wind >= 8) { score -= 20; reasons.push(`brisk wind ${wind.toFixed(0)}m/s`); }
  }

  if (h.t2m !== null) {
    if (h.t2m <= -15) { score -= 40; reasons.push(`very cold ${h.t2m.toFixed(0)}°C`); }
    else if (h.t2m <= -10) { score -= 25; reasons.push(`cold ${h.t2m.toFixed(0)}°C`); }
    else if (h.t2m <= -5) { score -= 15; reasons.push(`cold ${h.t2m.toFixed(0)}°C`); }
    else if (h.t2m >= 30) { score -= 15; reasons.push(`hot ${h.t2m.toFixed(0)}°C`); }
  }

  if (h.tcc !== null && h.tcc >= 90 && (h.rr ?? 0) < 0.2) {
    score -= 5; reasons.push(`overcast ${h.tcc.toFixed(0)}%`);
  }

  if (h.snow !== null && h.snow >= 0.3) {
    score -= 30; reasons.push(`snowfall ${h.snow.toFixed(1)}mm/h`);
  }

  score = Math.max(0, Math.min(100, score));

  let rating: ScoredHour["rating"];
  if (score >= 80) rating = "ideal";
  else if (score >= 60) rating = "good";
  else if (score >= 35) rating = "marginal";
  else rating = "avoid";

  return { ...h, score, rating, reasons };
}

/**
 * Find the best morning start per day for an alpine summit push.
 *
 * For each day, scores a 6-hour morning block (04:00-10:00 local) which
 * covers the realistic summit window for most Austrian alpine routes.
 * The climber decides actual duration from the hourly detail.
 */
export function findWindows(scored: ScoredHour[]): ClimbWindow[] {
  if (!scored.length) return [];

  const WINDOW_START = 4;   // 04:00 local
  const WINDOW_END = 14;    // through 14:00 local
  const MIN_HOURS = 4;
  const MIN_AVG_SCORE = 50;

  // Group by UTC calendar day (API timestamps are UTC)
  const dayMap = new Map<string, { hours: ScoredHour[]; globalIndices: number[] }>();
  for (let i = 0; i < scored.length; i++) {
    const d = new Date(scored[i].time);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
    if (!dayMap.has(key)) dayMap.set(key, { hours: [], globalIndices: [] });
    const entry = dayMap.get(key)!;
    entry.hours.push(scored[i]);
    entry.globalIndices.push(i);
  }

  const windows: ClimbWindow[] = [];

  for (const { hours: dayHours } of dayMap.values()) {
    // Collect the morning-through-early-afternoon hours (04:00-14:00 UTC)
    const run: ScoredHour[] = [];
    for (let si = 0; si < dayHours.length; si++) {
      const h = new Date(dayHours[si].time).getUTCHours();
      if (h >= WINDOW_START && h < WINDOW_END) {
        run.push(dayHours[si]);
      }
    }
    if (run.length < MIN_HOURS) continue;

    // Trim trailing hours that drag down the score (< 50)
    while (run.length > MIN_HOURS && run[run.length - 1].score < 50) run.pop();

    const avg = run.reduce((s, h) => s + h.score, 0) / run.length;
    if (avg < MIN_AVG_SCORE) continue;

    const rating: ScoredHour["rating"] =
      avg >= 80 ? "ideal" : avg >= 60 ? "good" : "marginal";
    const winds = run.map(h => h.gust ?? h.wsp ?? 0);
    const temps = run.map(h => h.t2m ?? 0);
    const maxWind = Math.max(...winds);
    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);

    windows.push({
      start: run[0].time,
      end: run[run.length - 1].time,
      hours: run.length,
      avgScore: Math.round(avg),
      rating,
      summary: `wind ≤${maxWind.toFixed(0)}m/s, ${minT.toFixed(0)}…${maxT.toFixed(0)}°C`,
    });
  }

  return windows.sort((a, b) => b.avgScore - a.avgScore);
}
