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
import type { ElevationBand, PeakWindowResult } from "./types.ts";
import { interpolateAtElevation, LAPSE_RATE_C_PER_M } from "./profile-interp.ts";

const SNOW_DENSITY_RATIO = 10;
export { LAPSE_RATE_C_PER_M };

// When true, summit wind speed/direction are taken from the interpolated pressure-level
// profile (free-air wind at summit height) instead of the provider's 10m surface wind.
// Gusts are ALWAYS kept from the provider — pressure levels have no gust field, and gusts
// drive the scoring veto. A no-op for providers without a profile (fallback returns the
// provider's own 10m wind), so GeoSphere behavior is unchanged.
const USE_PROFILE_WIND = true;

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

/**
 * Fixed-lapse temperature shift. Retained as the documented fallback model; the live
 * path now uses interpolateAtElevation (which falls back to this same formula when no
 * pressure-level profile is available).
 */
export function applyLapseCorrection(hours: HourData[], deltaC: number): HourData[] {
  return hours.map((h) => ({ ...h, t2m: h.t2m === null ? null : h.t2m + deltaC }));
}

export interface AnalyzeOptions {
  lat: number;
  lon: number;
  peakName?: string | null;
  summitElevationM?: number | null;
  // Optional explicit elevations for the route's lower bands; default to summit-1200
  // (clamped to grid elevation) and summit-600. `col` is only emitted when supplied.
  baseElevationM?: number | null;
  colElevationM?: number | null;
  profile?: PeakProfile | null;
}

/** Elevation of the 0°C isotherm given a temperature at a known elevation (inverted lapse). */
function freezingLevelAt(tempC: number, elevationM: number): number {
  return Math.round(elevationM + tempC / LAPSE_RATE_C_PER_M);
}

/** Forecast one elevation band by interpolating each hour to `elevationM`. */
function computeBand(
  hours: HourData[], elevationM: number, gridElevationM: number | null,
  label: ElevationBand["label"],
): ElevationBand {
  const t2m: (number | null)[] = [];
  const feelsLike: (number | null)[] = [];
  const freezingLevel: (number | null)[] = [];
  const precipType: ElevationBand["precipType"] = [];
  const method: ElevationBand["method"] = [];
  for (const h of hours) {
    const r = interpolateAtElevation(h.profile, elevationM, {
      t2m: h.t2m, gridElevationM, windMs: h.wsp, windDir: h.dd,
    });
    // Use the wind interpolated to this band's elevation (falls back to the provider's
    // 10m wind when no profile), so feels-like matches the band height — not surface wind.
    const bandWind = r.windMs ?? h.wsp;
    t2m.push(r.tempC);
    feelsLike.push(r.tempC != null && bandWind != null ? windChill(r.tempC, bandWind) : null);
    freezingLevel.push(r.tempC != null ? freezingLevelAt(r.tempC, elevationM) : null);
    precipType.push(derivePrecipType(h.rr, h.snow, h.snowlmt, elevationM));
    method.push(r.method);
  }
  return { label, elevationM, t2m, feelsLike, freezingLevel, precipType, method };
}

export function analyzeForecast(
  forecast: ForecastProviderResult,
  { lat, lon, peakName, summitElevationM, baseElevationM, colElevationM, profile }: AnalyzeOptions,
): PeakWindowResult {
  const { gridLat, gridLon, gridResolutionKm, providerId, source } = forecast;

  const gridElevationM = forecast.gridElevationM;
  let lapseDeltaC: number | null = null;
  if (summitElevationM != null && gridElevationM != null) {
    lapseDeltaC = (gridElevationM - summitElevationM) * LAPSE_RATE_C_PER_M;
  }
  // Correct temperature to the summit. When the provider supplied a vertical
  // pressure-level profile, interpolate the real atmosphere to summit height
  // (captures inversions); otherwise interpolateAtElevation falls back to the
  // same fixed-lapse shift as before. Work on shallow clones so derived-field
  // assignments never mutate the provider's hour objects.
  let usedProfile = false;
  const summitMethods: ElevationBand["method"] = [];
  const hours: HourData[] = forecast.hours.map((h) => {
    const clone: HourData = { ...h };
    // The bulky pressure-level profile is only needed for interpolation here; strip it so
    // it isn't carried into the scored hours and serialized into every MCP response.
    delete clone.profile;
    if (summitElevationM != null) {
      const r = interpolateAtElevation(h.profile, summitElevationM, {
        t2m: h.t2m, gridElevationM, windMs: h.wsp, windDir: h.dd,
      });
      clone.t2m = r.tempC;
      if (USE_PROFILE_WIND && r.windMs != null) {
        clone.wsp = r.windMs;
        if (r.windDir != null) clone.dd = r.windDir;
      }
      if (r.method === "profile") usedProfile = true;
      summitMethods.push(r.method);
    }
    return clone;
  });
  const interpMethod: "profile" | "lapse" | null =
    summitElevationM == null ? null : usedProfile ? "profile" : "lapse";

  for (const h of hours) {
    if (h.t2m != null && h.wsp != null) {
      h.feelsLike = windChill(h.t2m, h.wsp);
    }
    if (h.t2m != null && summitElevationM != null) {
      h.freezingLevel = freezingLevelAt(h.t2m, summitElevationM);
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

  // Per-elevation bands. Lower bands (base/mid/col) interpolate from the raw provider hours
  // to their elevation. The summit band IS the summit-corrected `hours` already computed and
  // scored above — reuse it directly so the two never diverge and the summit isn't
  // interpolated twice.
  const bands: ElevationBand[] = [];
  if (summitElevationM != null) {
    const base = baseElevationM
      ?? Math.max(summitElevationM - 1200, gridElevationM ?? summitElevationM - 1200);
    const mid = summitElevationM - 600;
    // base: emit whenever it sits below the summit (so an explicit base between mid and
    // summit is kept, not silently dropped; an invalid base >= summit is skipped).
    if (base < summitElevationM) bands.push(computeBand(forecast.hours, base, gridElevationM, "base"));
    // mid: only when it's a distinct level strictly between base and summit.
    if (mid > base && mid < summitElevationM) bands.push(computeBand(forecast.hours, mid, gridElevationM, "mid"));
    bands.push({
      label: "summit",
      elevationM: summitElevationM,
      t2m: hours.map((h) => h.t2m),
      feelsLike: hours.map((h) => h.feelsLike),
      freezingLevel: hours.map((h) => h.freezingLevel),
      precipType: hours.map((h) => h.precipType),
      method: summitMethods,
    });
    if (colElevationM != null && colElevationM < summitElevationM) {
      bands.push(computeBand(forecast.hours, colElevationM, gridElevationM, "col"));
    }
  }

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
    interpMethod,
    bands,
    lapseNote: interpMethod === "profile"
      ? `profile-interpolated to ${summitElevationM}m (pressure levels)`
      : lapseDeltaC != null
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
