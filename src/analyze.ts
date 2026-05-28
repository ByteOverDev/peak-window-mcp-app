/**
 * Turns a raw provider forecast into a scored PeakWindowResult.
 *
 * Shared by the MCP server (server.ts) and the browser showcase (test-ui.tsx),
 * so it must stay free of node-only and MCP-SDK dependencies — only the
 * forecast providers, the scoring module, and plain JS.
 */
import { findWindows, scoreHour, type HourData } from "./scoring.ts";
import type { ForecastProviderResult } from "./providers/types.ts";
import type { PeakProfile } from "./dem.ts";
import type { PeakWindowResult } from "./types.ts";

const SNOW_DENSITY_RATIO = 10;
export const LAPSE_RATE_C_PER_M = 0.0065;

/** Wind-chill (feels-like) temperature, °C. Returns t2m unchanged when wind is light/warm. */
export function windChill(tC: number, vMs: number): number {
  const vKmh = vMs * 3.6;
  if (tC > 10 || vKmh < 4.8) return tC;
  const v16 = Math.pow(vKmh, 0.16);
  return 13.12 + 0.6215 * tC - 11.37 * v16 + 0.3965 * tC * v16;
}

/** Classify precipitation at the summit from the snow line vs. summit elevation. */
export function derivePrecipType(
  rr: number | null, snow: number | null,
  snowlmt: number | null, summitElevationM: number | null,
): "none" | "rain" | "snow" | "mixed" {
  if ((rr ?? 0) < 0.05 && (snow ?? 0) < 0.05) return "none";
  if (snowlmt == null || summitElevationM == null) return "none";
  if (snowlmt + 100 < summitElevationM) return "snow";
  if (snowlmt > summitElevationM + 100) return "rain";
  return "mixed";
}

function applyLapseCorrection(hours: HourData[], deltaC: number): HourData[] {
  return hours.map((h) => ({ ...h, t2m: h.t2m === null ? null : h.t2m + deltaC }));
}

export interface AnalyzeOptions {
  lat: number;
  lon: number;
  peakName?: string | null;
  summitElevationM?: number | null;
  profile?: PeakProfile | null;
}

export function analyzeForecast(
  forecast: ForecastProviderResult,
  { lat, lon, peakName, summitElevationM, profile }: AnalyzeOptions,
): PeakWindowResult {
  const { gridLat, gridLon, gridResolutionKm, providerId, source } = forecast;

  const gridElevationM = forecast.gridElevationM;
  let lapseDeltaC: number | null = null;
  if (summitElevationM != null && gridElevationM != null) {
    lapseDeltaC = (gridElevationM - summitElevationM) * LAPSE_RATE_C_PER_M;
  }
  // Work on shallow clones so derived-field assignments never mutate the
  // provider's hour objects. applyLapseCorrection already returns new objects.
  const hours = lapseDeltaC != null
    ? applyLapseCorrection(forecast.hours, lapseDeltaC)
    : forecast.hours.map((h) => ({ ...h }));

  for (const h of hours) {
    if (h.t2m != null && h.wsp != null) {
      h.feelsLike = windChill(h.t2m, h.wsp);
    }
    if (h.t2m != null && summitElevationM != null) {
      h.freezingLevel = Math.round(summitElevationM + h.t2m / LAPSE_RATE_C_PER_M);
    }
    h.precipType = derivePrecipType(h.rr, h.snow, h.snowlmt, summitElevationM ?? null);
  }

  const scored = hours.map(scoreHour);
  const windows = findWindows(scored, summitElevationM);
  const top = windows.slice(0, 3);

  const snowMm = hours.map((h) => h.snow);
  const snowFreshCm = snowMm.map((v) => (v == null ? null : (v * SNOW_DENSITY_RATIO) / 10));
  const series = {
    time: hours.map((h) => Math.floor(new Date(h.time).getTime() / 1000)),
    t2m: hours.map((h) => h.t2m),
    ff: hours.map((h) => h.wsp),
    fx: hours.map((h) => h.gust),
    rr: hours.map((h) => h.rr),
    snow: snowMm,
    snowFresh: snowFreshCm,
    snowlmt: hours.map((h) => h.snowlmt),
    tcc: hours.map((h) => (h.tcc !== null ? h.tcc * 100 : null)),
    dd: hours.map((h) => h.dd),
    feelsLike: hours.map((h) => h.feelsLike),
    freezingLevel: hours.map((h) => h.freezingLevel),
    precipType: hours.map((h) => h.precipType),
  };

  const now = new Date().toISOString();
  return {
    peakName: peakName ?? null,
    summitElevationM: summitElevationM ?? null,
    gridElevationM,
    lapseDeltaC,
    lat, lon,
    gridLat, gridLon,
    gridResolutionKm,
    issued_at: now,
    fetchedAt: now,
    providerId,
    source,
    lapseNote: lapseDeltaC != null
      ? `lapse-corrected ${lapseDeltaC >= 0 ? "+" : ""}${lapseDeltaC.toFixed(1)}°C to ${summitElevationM}m`
      : null,
    hours: scored,
    windows: top,
    series,
    profile: profile?.profile ?? null,
    backProfile: profile?.backProfile ?? null,
    peakIdx: profile?.peakIdx ?? null,
  };
}
