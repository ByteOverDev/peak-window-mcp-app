export type { ScoredHour, ClimbWindow, HourData } from "./scoring.ts";
export type { VentuskySeries } from "./ventusky.tsx";

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
