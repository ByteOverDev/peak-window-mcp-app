/**
 * PeakWindow MCP server — analyzes climbing/ascent weather windows
 * using GeoSphere Austria (Central Europe) or Open-Meteo (global).
 */
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { fetchForecast } from "./src/providers/index.ts";
import { findWindows, scoreHour, type HourData } from "./src/scoring.ts";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const SNOW_DENSITY_RATIO = 10;
const LAPSE_RATE_C_PER_M = 0.0065;

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
        "Analyze upcoming hourly weather at a peak/trailhead and rank the best windows to climb or ascend. Uses GeoSphere AROME (2.5km) in Central Europe, MeteoSwiss ICON (2km) in the Alpine region, Open-Meteo globally.",
      inputSchema: {
        lat: z.number().min(-90).max(90).describe("Latitude in WGS84"),
        lon: z.number().min(-180).max(180).describe("Longitude in WGS84"),
        peakName: z.string().optional().describe("Optional peak / route name for display"),
        summitElevationM: z.number().optional()
          .describe("Summit elevation in meters. If set, temperatures are lapse-corrected from the forecast grid-cell elevation to the summit (-6.5°C/km)."),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ lat, lon, peakName, summitElevationM }): Promise<CallToolResult> => {
      try {
        const forecast = await fetchForecast(lat, lon);
        const { gridLat, gridLon, gridResolutionKm, source } = forecast;

        let hours = forecast.hours;
        let gridElevationM = forecast.gridElevationM;
        let lapseDeltaC: number | null = null;
        if (summitElevationM != null && gridElevationM != null) {
          lapseDeltaC = (gridElevationM - summitElevationM) * LAPSE_RATE_C_PER_M;
          hours = applyLapseCorrection(forecast.hours, lapseDeltaC);
        }

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
          gridResolutionKm,
          issued_at: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          source: source +
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
