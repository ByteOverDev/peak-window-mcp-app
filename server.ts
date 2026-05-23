/**
 * PeakWindow MCP server — analyzes climbing/ascent weather windows
 * using the GeoSphere Austria open-data API.
 */
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { findWindows, scoreHour, type HourData } from "./src/scoring.ts";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const GEOSPHERE_BASE = "https://dataset.api.hub.geosphere.at/v1";
const ELEVATION_BASE = "https://api.open-meteo.com/v1/elevation";
const FORECAST_RESOURCE = "nwp-v1-1h-2500m";
const FORECAST_RESOLUTION_KM = 2.5;
const PARAMS = ["t2m", "tcc", "rr_acc", "snow_acc", "snowlmt", "u10m", "v10m", "ugust", "vgust"];
const SNOW_DENSITY_RATIO = 10; // 1 mm water-equivalent ≈ 10 mm fresh snow depth
const LAPSE_RATE_C_PER_M = 0.0065; // standard environmental lapse rate

async function fetchElevation(lat: number, lon: number): Promise<number | null> {
  try {
    const url = new URL(ELEVATION_BASE);
    url.searchParams.set("latitude", lat.toString());
    url.searchParams.set("longitude", lon.toString());
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { elevation: number[] };
    return json.elevation?.[0] ?? null;
  } catch {
    return null;
  }
}

function magnitude(u: number | null | undefined, v: number | null | undefined): number | null {
  if (u == null || v == null) return null;
  return Math.sqrt(u * u + v * v);
}

function windDirection(u: number | null | undefined, v: number | null | undefined): number | null {
  if (u == null || v == null) return null;
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
}

function windChill(tC: number, vMs: number): number {
  const vKmh = vMs * 3.6;
  if (tC > 10 || vKmh < 4.8) return tC;
  const v16 = Math.pow(vKmh, 0.16);
  return 13.12 + 0.6215 * tC - 11.37 * v16 + 0.3965 * tC * v16;
}

function derivePrecipType(
  rr: number | null, snow: number | null,
  snowlmt: number | null, summitElevationM: number | null,
): "none" | "rain" | "snow" | "mixed" {
  if ((rr ?? 0) < 0.05 && (snow ?? 0) < 0.05) return "none";
  if (snowlmt == null || summitElevationM == null) return "none";
  if (snowlmt + 100 < summitElevationM) return "snow";
  if (snowlmt > summitElevationM + 100) return "rain";
  return "mixed";
}

/** Convert an accumulated series (since forecast start) into hourly deltas. */
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

interface GeoSphereForecast {
  timestamps: string[];
  features: Array<{
    geometry: { coordinates: [number, number] };  // [lon, lat]
    properties: {
      parameters: Record<string, { data: (number | null)[] }>;
    };
  }>;
}

interface ForecastResult {
  hours: HourData[];
  gridLat: number;
  gridLon: number;
}

async function fetchForecast(lat: number, lon: number): Promise<ForecastResult> {
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
  return { hours, gridLon: feat.geometry.coordinates[0], gridLat: feat.geometry.coordinates[1] };
}

function applyLapseCorrection(hours: HourData[], deltaC: number): HourData[] {
  return hours.map((h) => ({ ...h, t2m: h.t2m === null ? null : h.t2m + deltaC }));
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "PeakWindow", version: "1.0.0" });
  const resourceUri = "ui://peak-window/mcp-app.html";

  registerAppTool(server,
    "peak-window",
    {
      title: "PeakWindow",
      description:
        "Analyze upcoming hourly weather at a peak/trailhead (Austria coverage via GeoSphere) and rank the best windows to climb or ascend. Returns scored hours and contiguous good-weather windows.",
      inputSchema: {
        lat: z.number().min(-90).max(90).describe("Latitude in WGS84 (~46–49 for Austria)"),
        lon: z.number().min(-180).max(180).describe("Longitude in WGS84 (~9–17 for Austria)"),
        peakName: z.string().optional().describe("Optional peak / route name for display"),
        summitElevationM: z.number().optional()
          .describe("Summit elevation in meters. If set, temperatures are lapse-corrected from the GeoSphere 2.5km grid-cell elevation to the summit (-6.5°C/km)."),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ lat, lon, peakName, summitElevationM }): Promise<CallToolResult> => {
      try {
        const { hours: rawHours, gridLat, gridLon } = await fetchForecast(lat, lon);

        // Lapse-correct to summit elevation when caller provides one.
        let hours = rawHours;
        let gridElevationM: number | null = null;
        let lapseDeltaC: number | null = null;
        if (summitElevationM != null) {
          gridElevationM = await fetchElevation(gridLat, gridLon);
          if (gridElevationM != null) {
            lapseDeltaC = (gridElevationM - summitElevationM) * LAPSE_RATE_C_PER_M;
            hours = applyLapseCorrection(rawHours, lapseDeltaC);
          }
        }

        // Compute derived fields
        for (const h of hours) {
          if (h.t2m != null && h.wsp != null) {
            h.feelsLike = windChill(h.t2m, h.wsp);
          }
          if (h.t2m != null && summitElevationM != null) {
            h.freezingLevel = Math.round(summitElevationM + h.t2m / LAPSE_RATE_C_PER_M);
          }
          h.precipType = derivePrecipType(h.rr, h.snow, h.snowlmt, summitElevationM ?? null);
        }

        const scored = hours.map(scoreHour);
        const windows = findWindows(scored);
        const top = windows.slice(0, 3);

        const snowMm = hours.map((h) => h.snow);
        const snowFreshCm = snowMm.map((v) => (v == null ? null : (v * SNOW_DENSITY_RATIO) / 10));
        const series = {
          time: hours.map((h) => Math.floor(new Date(h.time).getTime() / 1000)),
          t2m: hours.map((h) => h.t2m),
          ff: hours.map((h) => h.wsp),
          fx: hours.map((h) => h.gust),
          rr: hours.map((h) => h.rr),
          snow: snowMm,
          snowFresh: snowFreshCm,
          snowlmt: hours.map((h) => h.snowlmt),
          tcc: hours.map((h) => (h.tcc !== null ? h.tcc * 100 : null)),
          dd: hours.map((h) => h.dd),
          feelsLike: hours.map((h) => h.feelsLike),
          freezingLevel: hours.map((h) => h.freezingLevel),
          precipType: hours.map((h) => h.precipType),
        };

        const snowTotalMm = snowMm.reduce((a: number, b) => a + (b ?? 0), 0);
        const snowTotalFreshCm = snowTotalMm * SNOW_DENSITY_RATIO / 10;

        const payload = {
          peakName: peakName ?? null,
          summitElevationM: summitElevationM ?? null,
          gridElevationM,
          lapseDeltaC,
          lat, lon,
          gridLat, gridLon,
          gridResolutionKm: FORECAST_RESOLUTION_KM,
          issued_at: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          source: "GeoSphere Austria — NWP 1h 2.5km" +
            (lapseDeltaC != null ? ` · lapse-corrected ${lapseDeltaC >= 0 ? "+" : ""}${lapseDeltaC.toFixed(1)}°C to ${summitElevationM}m` : ""),
          hours: scored,
          windows: top,
          series,
          snowTotalMm,
          snowTotalFreshCm,
        };

        const summary = top.length
          ? `Top window for ${peakName ?? `(${lat.toFixed(3)},${lon.toFixed(3)})`}: ` +
            top.map(w => `${w.start.slice(5, 16)} → ${w.end.slice(11, 16)} (${w.rating}, ${w.avgScore}/100)`).join(" | ")
          : `No suitable climbing window found in the forecast horizon for ${peakName ?? `(${lat.toFixed(3)},${lon.toFixed(3)})`}.`;

        return {
          content: [
            { type: "text", text: summary },
            { type: "text", text: JSON.stringify(payload) },
          ],
          structuredContent: payload,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: "text", text: `PeakWindow error: ${msg}` }] };
      }
    },
  );

  registerAppResource(server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              csp: {
                connectDomains: [
                  "https://dataset.api.hub.geosphere.at",
                  "https://api.open-meteo.com",
                ],
              },
            },
          },
        }],
      };
    },
  );

  return server;
}
