import type { HourData, VerticalLevel } from "../scoring.ts";
import type { ForecastProvider, ForecastProviderResult } from "./types.ts";

const OPENMETEO_BASE = "https://api.open-meteo.com/v1/forecast";
const HOURLY_PARAMS = [
  "temperature_2m",
  "precipitation",
  "snowfall",
  "cloud_cover",
  "freezing_level_height",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
].join(",");

// Pressure levels spanning the alpine band (~110 m at 1000hPa to ~5600 m at 500hPa).
// Used to interpolate temperature/wind to a summit's real elevation (captures inversions
// that a fixed lapse rate cannot). See src/profile-interp.ts.
const PRESSURE_LEVELS = [1000, 925, 850, 700, 600, 500];
const PROFILE_VARS = [
  "temperature",
  "wind_speed",
  "wind_direction",
  "geopotential_height",
  "relative_humidity",
];
const PRESSURE_PARAMS = PRESSURE_LEVELS.flatMap((p) =>
  PROFILE_VARS.map((v) => `${v}_${p}hPa`)
).join(",");

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: (number | null)[];
  precipitation: (number | null)[];
  snowfall: (number | null)[];
  cloud_cover: (number | null)[];
  freezing_level_height: (number | null)[];
  wind_speed_10m: (number | null)[];
  wind_gusts_10m: (number | null)[];
  wind_direction_10m: (number | null)[];
  // Dynamic pressure-level fields, e.g. temperature_850hPa, geopotential_height_850hPa.
  [key: string]: (number | null)[] | string[] | undefined;
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  hourly: OpenMeteoHourly;
}

function kmhToMs(v: number | null): number | null {
  return v != null ? v / 3.6 : null;
}

// Assemble the vertical profile for hour `i` from the dynamic pressure-level fields.
// Drops levels with no geopotential height, sorts ascending by height, and returns null
// when fewer than 2 usable levels exist (interpolation needs a bracket).
export function buildProfile(
  h: OpenMeteoHourly, i: number, levels: number[],
): VerticalLevel[] | null {
  const num = (key: string): number | null => {
    const arr = h[key] as (number | null)[] | undefined;
    return arr?.[i] ?? null;
  };
  const out: VerticalLevel[] = [];
  for (const p of levels) {
    const geopotentialHeightM = num(`geopotential_height_${p}hPa`);
    if (geopotentialHeightM == null) continue;
    out.push({
      pressureHPa: p,
      geopotentialHeightM,
      tempC: num(`temperature_${p}hPa`),
      windMs: kmhToMs(num(`wind_speed_${p}hPa`)),
      windDir: num(`wind_direction_${p}hPa`),
      rh: num(`relative_humidity_${p}hPa`),
    });
  }
  if (out.length < 2) return null;
  out.sort((a, b) => a.geopotentialHeightM - b.geopotentialHeightM);
  return out;
}

// Fetch freezing_level_height from the default (best-available) model
// for models that don't provide it natively.
async function fetchFreezingLevels(
  lat: number, lon: number, forecastDays: number,
): Promise<Map<string, number>> {
  const url = new URL(OPENMETEO_BASE);
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lon.toString());
  url.searchParams.set("hourly", "freezing_level_height");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("forecast_days", forecastDays.toString());
  try {
    const res = await fetch(url);
    if (!res.ok) return new Map();
    const json = (await res.json()) as { hourly: { time: string[]; freezing_level_height: (number | null)[] } };
    const map = new Map<string, number>();
    for (let i = 0; i < json.hourly.time.length; i++) {
      const v = json.hourly.freezing_level_height[i];
      if (v != null) map.set(json.hourly.time[i], v);
    }
    return map;
  } catch {
    return new Map();
  }
}

function hasData(arr: (number | null)[]): boolean {
  return arr.some((v) => v != null);
}

interface OpenMeteoProviderConfig {
  name: string;
  model?: string;
  gridResolutionKm: number;
  source: string;
  forecastDays: number;
  covers: (lat: number, lon: number) => boolean;
  // Request pressure-level data so summit temps can be profile-interpolated.
  pressureLevels?: boolean;
}

function createOpenMeteoProvider(config: OpenMeteoProviderConfig): ForecastProvider {
  return {
    name: config.name,
    covers: config.covers,

    async fetchForecast(lat, lon): Promise<ForecastProviderResult> {
      const url = new URL(OPENMETEO_BASE);
      url.searchParams.set("latitude", lat.toString());
      url.searchParams.set("longitude", lon.toString());
      url.searchParams.set(
        "hourly",
        config.pressureLevels ? `${HOURLY_PARAMS},${PRESSURE_PARAMS}` : HOURLY_PARAMS,
      );
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("forecast_days", config.forecastDays.toString());
      if (config.model) url.searchParams.set("models", config.model);

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Open-Meteo API error ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as OpenMeteoResponse;
      const h = json.hourly;

      // If the model doesn't provide freezing level, backfill from the default model
      let freezingLevels: Map<string, number> | null = null;
      if (!hasData(h.freezing_level_height)) {
        freezingLevels = await fetchFreezingLevels(lat, lon, config.forecastDays);
      }

      const hours: HourData[] = h.time.map((time, i) => ({
        time: time.length === 16 ? time + ":00Z" : time,
        t2m: h.temperature_2m[i] ?? null,
        rr: h.precipitation[i] ?? null,
        wsp: kmhToMs(h.wind_speed_10m[i]),
        gust: kmhToMs(h.wind_gusts_10m[i]),
        tcc: h.cloud_cover[i] != null ? h.cloud_cover[i]! / 100 : null,
        snow: h.snowfall[i] ?? null,
        snowlmt: h.freezing_level_height[i] ?? freezingLevels?.get(h.time[i]) ?? null,
        dd: h.wind_direction_10m[i] ?? null,
        feelsLike: null,
        freezingLevel: null,
        precipType: "none" as const,
        profile: config.pressureLevels ? buildProfile(h, i, PRESSURE_LEVELS) : null,
      }));

      return {
        hours,
        gridLat: json.latitude,
        gridLon: json.longitude,
        gridElevationM: json.elevation,
        gridResolutionKm: config.gridResolutionKm,
        providerId: config.name,
        source: config.source,
      };
    },
  };
}

export const meteoFranceProvider = createOpenMeteoProvider({
  name: "meteofrance",
  model: "meteofrance_arome_france",
  gridResolutionKm: 2.5,
  source: "Météo-France AROME via Open-Meteo — 2.5km",
  forecastDays: 2,
  pressureLevels: true,
  covers: (lat, lon) =>
    lat >= 38.0 && lat <= 55.0 && lon >= -9.0 && lon <= 14.0,
});

export const meteoSwissProvider = createOpenMeteoProvider({
  name: "meteoswiss",
  model: "meteoswiss_icon_ch2",
  gridResolutionKm: 2,
  source: "MeteoSwiss ICON-CH2 via Open-Meteo — 2km",
  forecastDays: 5,
  // ICON-CH2 does not expose pressure-level fields via Open-Meteo (they return all-null),
  // so requesting them is pure payload waste. Summit temps fall back to fixed lapse here.
  pressureLevels: false,
  covers: (lat, lon) =>
    lat >= 43.0 && lat <= 49.9 && lon >= 0.5 && lon <= 16.5,
});

export const openMeteoProvider = createOpenMeteoProvider({
  name: "open-meteo",
  gridResolutionKm: 11,
  source: "Open-Meteo — Best Available ~11km",
  forecastDays: 3,
  pressureLevels: true,
  covers: () => true,
});
