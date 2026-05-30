export type { ScoredHour, ClimbWindow, HourData } from "./scoring.ts";
export type { VentuskySeries } from "./ventusky.tsx";

/**
 * A forecast at one elevation along the route. Per-hour arrays are index-aligned with
 * `PeakWindowResult.series.time`. Windowing/scoring stays summit-driven; bands are
 * additive temperature/precip context for the UI.
 */
export interface ElevationBand {
  label: "base" | "mid" | "summit" | "col";
  elevationM: number;
  t2m: (number | null)[];
  feelsLike: (number | null)[];
  freezingLevel: (number | null)[];
  precipType: ("none" | "rain" | "snow" | "mixed")[];
  method: ("profile" | "lapse-extrapolate" | "lapse-fallback")[];
}

export interface PeakWindowResult {
  peakName: string | null;
  summitElevationM: number | null;
  gridElevationM: number | null;
  lapseDeltaC: number | null;
  lat: number;
  lon: number;
  gridLat: number;
  gridLon: number;
  gridResolutionKm: number;
  issued_at: string;
  fetchedAt: string;
  providerId: string;
  source: string;
  // How summit temperature was derived: "profile" = pressure-level interpolation,
  // "lapse" = fixed lapse rate, null = no summit elevation supplied.
  interpMethod: "profile" | "lapse" | null;
  // Per-elevation forecasts (base/mid/summit/optional col). Empty when no summit elevation.
  bands: ElevationBand[];
  lapseNote: string | null;
  hours: import("./scoring.ts").ScoredHour[];
  windows: import("./scoring.ts").ClimbWindow[];
  series: import("./ventusky.tsx").VentuskySeries;
  // Real elevation silhouette (Open-Meteo DEM); null when the fetch failed.
  profile: number[] | null;
  backProfile: number[] | null;
  peakIdx: number | null;
}

export interface CursorState {
  idx: number;
  clientX: number;
  clientY: number;
  source: "chart" | "tape";
}

export interface SunMarker {
  dayStart: number;
  sunriseEpoch: number;
  sunsetEpoch: number;
}
