import type { HourData } from "../scoring.ts";
import type { ForecastProvider, ForecastProviderResult } from "./types.ts";

const GEOSPHERE_BASE = "https://dataset.api.hub.geosphere.at/v1";
const FORECAST_RESOURCE = "nwp-v1-1h-2500m";
const PARAMS = ["t2m", "tcc", "rr_acc", "snow_acc", "snowlmt", "u10m", "v10m", "ugust", "vgust", "sp"];

// AROME NWP model bounding box
const BBOX = { south: 42.98, west: 5.50, north: 51.82, east: 22.10 };

interface GeoSphereForecast {
  timestamps: string[];
  features: Array<{
    geometry: { coordinates: [number, number] };
    properties: {
      parameters: Record<string, { data: (number | null)[] }>;
    };
  }>;
}

function magnitude(u: number | null | undefined, v: number | null | undefined): number | null {
  if (u == null || v == null) return null;
  return Math.sqrt(u * u + v * v);
}

function windDirection(u: number | null | undefined, v: number | null | undefined): number | null {
  if (u == null || v == null) return null;
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
}

// Derive model terrain elevation from surface pressure (hypsometric formula)
function modelTerrainFromPressure(spPa: number | null): number | null {
  if (spPa == null) return null;
  return Math.round(44330 * (1 - Math.pow(spPa / 101325, 0.1903)));
}

function deaccumulate(series: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  let prev: number | null = 0;
  for (const v of series) {
    if (v == null) { out.push(null); prev = null; continue; }
    out.push(prev == null ? 0 : Math.max(0, v - prev));
    prev = v;
  }
  return out;
}

export const geosphereProvider: ForecastProvider = {
  name: "geosphere",

  covers(lat, lon) {
    return lat >= BBOX.south && lat <= BBOX.north && lon >= BBOX.west && lon <= BBOX.east;
  },

  async fetchForecast(lat, lon): Promise<ForecastProviderResult> {
    const url = new URL(`${GEOSPHERE_BASE}/timeseries/forecast/${FORECAST_RESOURCE}`);
    url.searchParams.set("lat_lon", `${lat},${lon}`);
    url.searchParams.set("parameters", PARAMS.join(","));
    url.searchParams.set("output_format", "geojson");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`GeoSphere API error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as GeoSphereForecast;

    const feat = json.features[0];
    const params = feat.properties.parameters;
    const rr = deaccumulate(params.rr_acc?.data ?? []);
    const snow = deaccumulate(params.snow_acc?.data ?? []);

    const hours: HourData[] = json.timestamps.map((time, i) => ({
      time,
      t2m: params.t2m?.data[i] ?? null,
      rr: rr[i] ?? null,
      wsp: magnitude(params.u10m?.data[i], params.v10m?.data[i]),
      gust: magnitude(params.ugust?.data[i], params.vgust?.data[i]),
      tcc: params.tcc?.data[i] ?? null,
      snow: snow[i] ?? null,
      snowlmt: params.snowlmt?.data[i] ?? null,
      dd: windDirection(params.u10m?.data[i], params.v10m?.data[i]),
      feelsLike: null,
      freezingLevel: null,
      precipType: "none" as const,
    }));

    // Use first timestep's surface pressure to derive model terrain elevation
    const sp0 = params.sp?.data[0] ?? null;
    const gridElevationM = modelTerrainFromPressure(sp0);

    return {
      hours,
      gridLat: feat.geometry.coordinates[1],
      gridLon: feat.geometry.coordinates[0],
      gridElevationM,
      gridResolutionKm: 2.5,
      source: "GeoSphere Austria — NWP 1h 2.5km",
    };
  },
};
