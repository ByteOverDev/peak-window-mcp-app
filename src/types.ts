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
  source: string;
  hours: import("./scoring.ts").ScoredHour[];
  windows: import("./scoring.ts").ClimbWindow[];
  series: import("./ventusky.tsx").VentuskySeries;
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
