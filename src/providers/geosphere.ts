import type { HourData } from "../scoring.ts";
import type { ForecastProvider, ForecastProviderResult } from "./types.ts";

const GEOSPHERE_BASE = "https://dataset.api.hub.geosphere.at/v1";
const FORECAST_RESOURCE = "nwp-v1-1h-2500m";
const PARAMS = ["t2m", "tcc", "rr_acc", "snow_acc", "snowlmt", "u10m", "v10m", "ugust", "vgust", "sp"];

// True AROME model domain — documents the data extent (the API serves this whole box).
const BBOX = { south: 42.98, west: 5.50, north: 51.82, east: 22.10 };

// GeoSphere's AROME is Austria-centric: its skill is best over Austria and the Eastern
// Alps and degrades toward the western edge of its domain. So we only make it the FIRST
// choice east of ~9.5°E (roughly the Austria–Switzerland border). West of that — the
// Swiss/French/Italian Alps (e.g. Matterhorn at 7.66°E) — the region-tuned MeteoSwiss
// ICON-CH2 (2 km) and Météo-France AROME, next in the router order, take precedence.
const PREFERRED_WEST = 9.5;

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
    // Prefer GeoSphere only over its Austria-centric core; west of PREFERRED_WEST the
    // router falls through to MeteoSwiss/Météo-France (still inside the true BBOX domain).
    return lat >= BBOX.south && lat <= BBOX.north && lon >= PREFERRED_WEST && lon <= BBOX.east;
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
      providerId: "geosphere",
      source: "GeoSphere Austria — NWP 1h 2.5km",
    };
  },
};
