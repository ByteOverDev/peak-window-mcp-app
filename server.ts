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
import { resolvePeak } from "./src/peaks.ts";
import { fetchPeakProfile } from "./src/dem.ts";
import { analyzeForecast } from "./src/analyze.ts";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

export function createServer(): McpServer {
  const server = new McpServer({ name: "PeakWindow", version: "1.0.0" });
  const resourceUri = "ui://peak-window/mcp-app.html";

  registerAppTool(server,
    "peak-window",
    {
      title: "PeakWindow",
      description:
        "Scores ascent/summit weather windows for any mountain worldwide, automatically picking the highest-resolution forecast model for the region (GeoSphere AROME 2.5km in the Alps, MeteoSwiss ICON 2km, Météo-France AROME 2.5km, Open-Meteo ~11km elsewhere). Call whenever the user asks about climbing, ascending, or summit conditions for a peak. Accepts a peak name (e.g. 'Großglockner', 'Mont Blanc') or explicit coordinates. Forecast horizon is ~48–60h — frame results as 'this weekend', not a full week.",
      inputSchema: {
        peak: z.string().optional()
          .describe("Peak name, e.g. 'Großglockner' or 'Mont Blanc'. Resolved to coordinates + summit elevation when known. Provide this OR lat/lon."),
        lat: z.number().min(-90).max(90).optional().describe("Latitude in WGS84 (overrides the named peak if both given)"),
        lon: z.number().min(-180).max(180).optional().describe("Longitude in WGS84 (overrides the named peak if both given)"),
        peakName: z.string().optional().describe("Optional display name (defaults to the resolved peak's name)"),
        summitElevationM: z.number().optional()
          .describe("Summit elevation in meters. If set, summit temperature is interpolated from the model's pressure-level profile to that elevation (captures inversions), falling back to a -6.5°C/km lapse rate when the provider has no profile."),
        baseElevationM: z.number().optional()
          .describe("Optional trailhead/base elevation in meters for the lower forecast band (defaults to summit-1200m, clamped to the grid elevation)."),
        colElevationM: z.number().optional()
          .describe("Optional col/saddle elevation in meters to add as an extra forecast band."),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ peak, lat, lon, peakName, summitElevationM, baseElevationM, colElevationM }): Promise<CallToolResult> => {
      try {
        // Resolve a named peak to authoritative coords/elevation; explicit lat/lon always win.
        if (peak) {
          const entry = resolvePeak(peak);
          if (entry) {
            lat = lat ?? entry.lat;
            lon = lon ?? entry.lon;
            summitElevationM = summitElevationM ?? entry.elevationM;
            peakName = peakName ?? entry.name;
          }
        }

        if (lat == null || lon == null) {
          const what = peak ? `"${peak}"` : "that location";
          return {
            content: [{
              type: "text",
              text: `I don't know ${what} by name — pass latitude/longitude (and summit elevation if you have it) and I'll score it.`,
            }],
          };
        }

        const [forecast, profile] = await Promise.all([
          fetchForecast(lat, lon),
          fetchPeakProfile(lat, lon).catch(() => null),
        ]);
        const payload = analyzeForecast(forecast, {
          lat, lon, peakName, summitElevationM, baseElevationM, colElevationM, profile,
        });
        const top = payload.windows;

        const where = peakName ?? `(${lat.toFixed(3)},${lon.toFixed(3)})`;
        const windowLine = top.length
          ? `Top window for ${where}: ` +
            top.map(w => `${w.start.slice(5, 16)} → ${w.end.slice(11, 16)} (${w.rating}, ${w.score}/100)`).join(" | ")
          : `No suitable climbing window found in the forecast horizon for ${where}.`;

        // One-line per-band temperature range (min…max over the horizon).
        const bandLine = payload.bands.length
          ? "Elevation bands: " + payload.bands.map((b) => {
              const ts = b.t2m.filter((t): t is number => t != null);
              const range = ts.length ? `${Math.min(...ts).toFixed(0)}…${Math.max(...ts).toFixed(0)}°C` : "n/a";
              return `${b.label} ${b.elevationM}m ${range}`;
            }).join(" · ")
          : "";
        const summary = bandLine ? `${windowLine}\n${bandLine}` : windowLine;

        return {
          content: [
            { type: "text", text: summary },
            { type: "text", text: JSON.stringify(payload) },
          ],
          structuredContent: { ...payload },
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
