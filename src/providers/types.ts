import type { HourData } from "../scoring.ts";

export interface ForecastProviderResult {
  hours: HourData[];
  gridLat: number;
  gridLon: number;
  gridElevationM: number | null;
  gridResolutionKm: number;
  providerId: string; // stable id matching ForecastProvider.name (for UI color-coding)
  source: string; // clean human-readable model label (no lapse note)
}

export interface ForecastProvider {
  readonly name: string;
  covers(lat: number, lon: number): boolean;
  fetchForecast(lat: number, lon: number): Promise<ForecastProviderResult>;
}
