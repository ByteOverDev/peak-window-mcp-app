/**
 * Interpolates a model's vertical pressure-level profile to a target elevation.
 *
 * This replaces a fixed lapse rate with a sample of the *actual* atmosphere at the
 * summit's height — the technique mountain-forecast.com uses to capture inversions
 * (valley cold pools, foehn) that a constant -6.5°C/km cannot represent.
 *
 * Pure, dependency-free (only the VerticalLevel type), so it stays usable by both the
 * MCP server and the browser showcase. Falls back to fixed-lapse whenever profile data
 * is missing, reproducing the prior behavior exactly.
 */
import type { VerticalLevel } from "./scoring.ts";

export const LAPSE_RATE_C_PER_M = 0.0065; // -6.5°C per 1000 m (standard atmosphere)

export interface InterpResult {
  tempC: number | null;
  windMs: number | null;
  windDir: number | null;
  method: "profile" | "lapse-extrapolate" | "lapse-fallback";
}

export interface InterpFallback {
  t2m: number | null;
  gridElevationM: number | null;
  windMs: number | null;
  windDir: number | null;
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-angle interpolation between two compass bearings (degrees). */
export function circularLerp(a: number, b: number, t: number): number {
  let diff = ((b - a + 540) % 360) - 180; // signed shortest delta, -180..180
  return ((a + diff * t) % 360 + 360) % 360;
}

/** Nullable linear interp: if either endpoint is null, returns the other (or null). */
function lerpN(a: number | null, b: number | null, t: number): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return lerp(a, b, t);
}

/** Nullable circular interp for wind direction. */
function circLerpN(a: number | null, b: number | null, t: number): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return circularLerp(a, b, t);
}

/** Fixed-lapse temperature from a known reference temp/elevation to the target. */
function lapseTemp(refTempC: number, refElevationM: number, targetM: number): number {
  return refTempC + (refElevationM - targetM) * LAPSE_RATE_C_PER_M;
}

/**
 * Interpolate temperature and wind to `targetElevationM`.
 *
 * - No / <2-level profile → `lapse-fallback`: lapse from grid t2m (matches the old
 *   applyLapseCorrection formula exactly).
 * - Target between two profile levels → `profile`: linear interp in geopotential height.
 * - Target below lowest / above highest level → `lapse-extrapolate`: lapse from the
 *   nearest profile level (better-anchored than the smoothed grid value).
 */
export function interpolateAtElevation(
  profile: VerticalLevel[] | null | undefined,
  targetElevationM: number,
  fallback: InterpFallback,
): InterpResult {
  if (!profile || profile.length < 2) {
    const tempC = fallback.t2m == null || fallback.gridElevationM == null
      ? fallback.t2m
      : lapseTemp(fallback.t2m, fallback.gridElevationM, targetElevationM);
    return { tempC, windMs: fallback.windMs, windDir: fallback.windDir, method: "lapse-fallback" };
  }

  // profile is sorted ascending by geopotential height.
  const lowest = profile[0];
  const highest = profile[profile.length - 1];

  if (targetElevationM <= lowest.geopotentialHeightM) {
    return {
      tempC: lowest.tempC == null
        ? null
        : lapseTemp(lowest.tempC, lowest.geopotentialHeightM, targetElevationM),
      windMs: lowest.windMs,
      windDir: lowest.windDir,
      method: "lapse-extrapolate",
    };
  }
  if (targetElevationM >= highest.geopotentialHeightM) {
    return {
      tempC: highest.tempC == null
        ? null
        : lapseTemp(highest.tempC, highest.geopotentialHeightM, targetElevationM),
      windMs: highest.windMs,
      windDir: highest.windDir,
      method: "lapse-extrapolate",
    };
  }

  // Find the bracketing pair and interpolate in height.
  for (let i = 0; i < profile.length - 1; i++) {
    const lo = profile[i];
    const hi = profile[i + 1];
    if (targetElevationM >= lo.geopotentialHeightM && targetElevationM <= hi.geopotentialHeightM) {
      const span = hi.geopotentialHeightM - lo.geopotentialHeightM;
      const t = span === 0 ? 0 : (targetElevationM - lo.geopotentialHeightM) / span;
      return {
        tempC: lerpN(lo.tempC, hi.tempC, t),
        windMs: lerpN(lo.windMs, hi.windMs, t),
        windDir: circLerpN(lo.windDir, hi.windDir, t),
        method: "profile",
      };
    }
  }

  // Unreachable given the bounds checks above, but stay safe.
  return { tempC: fallback.t2m, windMs: fallback.windMs, windDir: fallback.windDir, method: "lapse-fallback" };
}
