import type { HourData } from "../scoring.ts";

export interface ForecastProviderResult {
  hours: HourData[];
  gridLat: number;
  gridLon: number;
  gridElevationM: number | null;
  gridResolutionKm: number;
  source: string;
}

export interface ForecastProvider {
  readonly name: string;
  covers(lat: number, lon: number): boolean;
  fetchForecast(lat: number, lon: number): Promise<ForecastProviderResult>;
}
