# PeakWindow MCP App

An MCP App that analyzes upcoming weather at alpine peaks and trailheads across Austria, ranking the best windows for climbing and ascent. Powered by the GeoSphere Austria NWP forecast (AROME 2.5 km, hourly).

![PeakWindow UI](screenshot.png)

## What it does

- Fetches hourly forecasts (temperature, precipitation, wind, gusts, cloud cover, snow line) from the GeoSphere Austria open-data API
- Lapse-corrects temperatures to summit elevation using the standard environmental lapse rate (-6.5 °C/km) and Open-Meteo DEM
- Scores each hour against alpine climbing thresholds and identifies contiguous good-weather windows
- Serves an interactive UI (React, uPlot charts) as an MCP App resource with horizon tape, mountain profile, and Ventusky-style chart panels

## Requirements

This is an **MCP App** — it requires an MCP host that supports the [Apps protocol](https://apps.extensions.modelcontextprotocol.io/) to render its interactive UI. Compatible hosts include:

- [Claude Desktop](https://claude.ai/download) (macOS / Windows)
- [ChatGPT](https://chatgpt.com/) (via OpenAI Apps SDK)
- Any chat client implementing the MCP Apps spec

The server runs as a standard MCP server over **stdio** or **SSE**. The rich UI (charts, horizon tape, mountain profile) renders inline in any compliant host. Without one you still get the scored text output.

[Live UI demo (static mock data)](https://byteoverdev.github.io/peak-window-mcp-app/)

## Setup

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "peak-window": {
      "command": "npx",
      "args": ["tsx", "/path/to/peak-window-mcp-app/main.ts", "--stdio"]
    }
  }
}
```

Then ask Claude something like: *"What's the best weather window to climb Großglockner this week?"*

### Manual / development

```bash
npm install
npm run build
npm run serve          # HTTP + SSE transport
npm run serve:stdio    # stdio transport
```

For development with hot reload:

```bash
npm run dev
```

## MCP tool

**`peak-window`** — provide `lat`, `lon`, and optionally `peakName` and `summitElevationM`. Returns scored hours, top weather windows, and a full time-series payload rendered by the embedded UI.

## Data sources

- [GeoSphere Austria](https://data.hub.geosphere.at/) — NWP forecast (`nwp-v1-1h-2500m`)
- [Open-Meteo Elevation API](https://open-meteo.com/) — grid-cell DEM for lapse correction
