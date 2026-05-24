import type { ForecastProviderResult } from "./types.ts";
import { geosphereProvider } from "./geosphere.ts";
import { meteoFranceProvider, meteoSwissProvider, openMeteoProvider } from "./openmeteo.ts";

// Ordered by preference: direct APIs first, then high-res wrappers, global fallback last.
// GeoSphere wins in Central Europe (direct API, full native params).
// MeteoSwiss (2km) and Météo-France (2.5km) fill gaps via Open-Meteo wrappers.
const providers = [geosphereProvider, meteoSwissProvider, meteoFranceProvider, openMeteoProvider];

export async function fetchForecast(lat: number, lon: number): Promise<ForecastProviderResult> {
  for (const provider of providers) {
    if (!provider.covers(lat, lon)) continue;
    try {
      return await provider.fetchForecast(lat, lon);
    } catch (err) {
      if (provider !== providers.at(-1)) {
        console.error(`${provider.name} failed, falling back:`, err);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`No forecast provider covers (${lat}, ${lon})`);
}

export type { ForecastProviderResult };
