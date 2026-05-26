# Weather MCP Project

## Forecast Provider Architecture

PeakWindow uses a multi-provider abstraction (`src/providers/`) to select the best forecast source for each location. Providers are tried in priority order; on API failure, the router falls through to the next.

| Priority | Provider | Resolution | Coverage | Source |
|---|---|---|---|---|
| 1 | GeoSphere Austria | 2.5 km | Central Europe (5.5–22.1°E, 43–51.8°N) | Direct API (`dataset.api.hub.geosphere.at`) |
| 2 | MeteoSwiss ICON-CH2 | 2 km | Alpine region (0.5–16.5°E, 43–49.9°N) | Open-Meteo (`models=meteoswiss_icon_ch2`) |
| 3 | Météo-France AROME | 2.5 km | France & surrounds (-9–14°E, 38–55°N) | Open-Meteo (`models=meteofrance_arome_france`) |
| 4 | Open-Meteo default | ~11 km | Global | Open-Meteo (best available model blend) |

Key files:
- `src/providers/types.ts` — `ForecastProvider` interface, `ForecastProviderResult`
- `src/providers/geosphere.ts` — direct GeoSphere API (deaccumulates precip, derives model terrain from `sp`)
- `src/providers/openmeteo.ts` — factory for Open-Meteo-based providers (MeteoSwiss, Météo-France, default)
- `src/providers/index.ts` — router with ordered fallback

### Lapse correction

GeoSphere reports t2m at the NWP model's smoothed terrain, not at DEM elevation. The model terrain is derived from `sp` (surface pressure) via the hypsometric formula. Open-Meteo providers use the `elevation` field from the response (already downscaled to DEM). When a provider doesn't supply `freezing_level_height`, it's backfilled from the Open-Meteo default model.

## Scoring System (`src/scoring.ts`)

Two-level scoring for alpine ascent suitability: per-hour and per-window.

### Per-hour scoring (`scoreHour`)

Starts at 100, subtracts penalties using continuous interpolation (`lerp`) within bands. Inputs: gust (or wind speed), precip rate, feels-like temp (or t2m), snow rate, cloud cover.

| Factor | Bands (value → penalty) |
|---|---|
| Wind (gust m/s) | 8–12 → 12–30, 12–15 → 30–45, 15–20 → 45–65, ≥20 → 65 |
| Precip (mm/h) | 0.2–0.5 → 8–20, 0.5–1.0 → 20–40, 1.0–2.0 → 40–65, ≥2.0 → 65 |
| Cold (feels-like °C) | -5 to -10 → 12–25, -10 to -15 → 25–40, ≤-15 → 40 |
| Heat (°C) | ≥30 → 15 |
| Snow (mm/h) | 0.3–1.0 → 15–30, ≥1.0 → 30 |
| Overcast | ≥90% cloud + dry → 5 |

### Window-level scoring (`scoreWindow`)

Scores the climb window based on **worst-case metrics** across its hours, not the average of per-hour scores. This prevents dangerous spikes (e.g., one hour of 19 m/s gusts) from being diluted by calm hours.

**Hard veto** (caps score at 30 = "avoid"):
- Any hour with gust ≥ 20 m/s
- Any hour with precip ≥ 2.0 mm/h

**Scaled penalties** (continuous interpolation):

| Factor | Input | Bands → Penalty |
|---|---|---|
| Wind | max gust | 8–12 → 10–25, 12–15 → 25–40, 15–20 → 40–55 |
| Precip rate | max mm/h | 0.2–0.5 → 5–15, 0.5–1.0 → 15–35, 1.0–2.0 → 35–55 |
| Precip total | sum mm | 2–5 → 8–20, ≥5 → 20 (stacks with rate) |
| Cold | min feels-like | -5 to -10 → 10–20, -10 to -15 → 20–35, ≤-15 → 35 |
| Snow rate | max mm/h | 0.3–1.0 → 15–30, ≥1.0 → 30 |
| Cloud | avg cover | 0.75–0.9 → 4, ≥0.9 → 8 |
| Freezing level | fraction of hours summit above 0°C line | >50% → 10–20 |

### Rating tiers (5 levels)

| Rating | Score range | Meaning |
|---|---|---|
| ideal | ≥ 80 | Excellent conditions, go with confidence |
| good | ≥ 65 | Solid conditions, normal precautions |
| fair | ≥ 45 | Challenging but doable for experienced climbers |
| marginal | ≥ 30 | Demanding — experienced + properly equipped only |
| avoid | < 30 | Dangerous, don't go |

### Window finding (`findWindows`)

Groups scored hours by UTC day. For each day, extracts hours 04:00–14:00 UTC, trims trailing low-score hours, calls `scoreWindow()` on the slice. Accepts optional `summitElevation` for freezing-level penalty. Minimum window score: 30. Returns windows sorted by score descending.

## Open-Meteo API (`api.open-meteo.com/v1`)

Open-Meteo provides free, keyless, global weather forecasts. Used both as a provider (default global fallback) and as a wrapper for national models (MeteoSwiss, Météo-France).

Base URL: `https://api.open-meteo.com/v1/forecast`

### Parameter names (underscore-separated)

`temperature_2m`, `precipitation`, `snowfall`, `cloud_cover`, `freezing_level_height`, `wind_speed_10m`, `wind_gusts_10m`, `wind_direction_10m`, `surface_pressure`

### Unit conversions (Open-Meteo → HourData)

| Open-Meteo | HourData field | Conversion |
|---|---|---|
| `temperature_2m` (°C) | `t2m` | direct |
| `precipitation` (mm) | `rr` | direct (already hourly) |
| `snowfall` (cm) | `snow` | direct (1 cm snow ≈ 1 mm water-equiv) |
| `cloud_cover` (0–100%) | `tcc` | ÷ 100 → 0–1 fraction |
| `freezing_level_height` (m) | `snowlmt` | direct |
| `wind_speed_10m` (km/h) | `wsp` | ÷ 3.6 → m/s |
| `wind_gusts_10m` (km/h) | `gust` | ÷ 3.6 → m/s |
| `wind_direction_10m` (°) | `dd` | direct |

### Model selection

Use `&models=<model_id>` to select a specific model. Without it, Open-Meteo uses the best available blend. Time format: `"2026-05-24T14:00"` (no timezone suffix when `&timezone=UTC`; append `:00Z` for ISO 8601).

## GeoSphere Austria API (`dataset.api.hub.geosphere.at/v1`)

GeoSphere Austria's open data API providing weather observations, forecasts, and climate data for Austria and surrounding regions. Base URL: `https://dataset.api.hub.geosphere.at/v1/`

All coordinates are WGS84. All times are UTC. Output formats: GeoJSON, CSV, NetCDF (varies by endpoint).

### Data Access Patterns

The API is organized along two axes:

**Type** (how data is spatially organized):
- `station` — point observations from physical weather stations
- `grid` — spatially interpolated raster data, queried by bounding box (`south,west,north,east`)
- `timeseries` — grid data extracted at specific lat/lon points

**Mode** (temporal orientation):
- `current` — latest observations (station only)
- `historical` — archived past data
- `forecast` — NWP model output, future-looking

URL pattern: `/v1/{type}/{mode}/{resource_id}`

### Key Datasets

#### Station Data
| Resource ID | Mode | Frequency | Description |
|---|---|---|---|
| `tawes-v1-10min` | current + historical | 10 min | TAWES automatic weather stations — the primary real-time observation network |
| `klima-v2-10min` | historical | 10 min | Climate station network (v2), high-resolution |
| `klima-v2-1h` | historical | 1 hour | Climate station network, hourly |
| `klima-v2-1d` | historical | 1 day | Climate station network, daily |
| `klima-v2-1m` | historical | 1 month | Climate station network, monthly |
| `klima-v2-1y` | historical | 1 year | Climate station network, yearly |
| `synop-v1-1h` | historical | 1 hour | SYNOP reports |
| `histalp-v1-1y` | historical | 1 year | HISTALP long-term Alpine climate series |

#### Grid / Timeseries Data
| Resource ID | Mode | Resolution | Description |
|---|---|---|---|
| `nwp-v1-1h-2500m` | forecast | 1h / 2.5km | AROME NWP model — primary forecast product |
| `nowcast-v1-15min-1km` | forecast | 15min / 1km | Short-range nowcast |
| `inca-v1-1h-1km` | historical | 1h / 1km | INCA analysis (integrated nowcasting) |
| `spartacus-v2-1d-1km` | historical | daily / 1km | Gridded climate analysis (temp, precip, radiation) |
| `spartacus-v2-1m-1km` | historical | monthly / 1km | SPARTACUS monthly aggregates |
| `spartacus-v2-1q-1km` | historical | quarterly / 1km | SPARTACUS quarterly aggregates |
| `spartacus-v2-1y-1km` | historical | yearly / 1km | SPARTACUS yearly aggregates |
| `snowgrid_cl-v2-1d-1km` | historical | daily / 1km | Snow depth and water equivalent |
| `winfore-v2-1d-1km` | historical | daily / 1km | Wind forest (forestry-relevant wind data) |
| `apolis_short-v1-1d-100m` | historical | daily / 100m | High-resolution urban climate |
| `ensemble-v1-1h-2500m` | forecast | 1h / 2.5km | Ensemble forecast (probabilistic) |
| `chem-v2-1h-3km` | forecast | 1h / 3km | Air quality / chemistry forecast |
| `chem-v2-1h-9km` | forecast | 1h / 9km | Air quality / chemistry forecast (coarser) |

### NWP Forecast Parameters (`nwp-v1-1h-2500m`)

The main forecast model covers bbox `[42.98, 5.50, 51.82, 22.10]` (Central Europe) with 2.5km spacing, 61h horizon, updated every 3 hours.

| Parameter | Description | Unit |
|---|---|---|
| `t2m` | 2m temperature | °C |
| `mnt2m` / `mxt2m` | Min / max 2m temperature | °C |
| `rh2m` | Relative humidity 2m | % |
| `rr_acc` | Accumulated precipitation | kg/m² |
| `rain_acc` | Accumulated rainfall | kg/m² |
| `snow_acc` | Accumulated snowfall | kg/m² |
| `snowlmt` | Snow line elevation | m |
| `u10m` / `v10m` | 10m wind components (E/N) | m/s |
| `ugust` / `vgust` | Max gust components | m/s |
| `tcc` | Total cloud cover | 0-1 |
| `sp` | Surface pressure | Pa |
| `grad` | Global radiation | Ws/m² |
| `cape` | Convective available potential energy | m²/s² |
| `cin` | Convective inhibition | J/kg |
| `sundur_acc` | Accumulated sunshine duration | s |
| `sy` | Weather symbol code | - |

### TAWES Station Parameters (current observations)

Key parameters from `tawes-v1-10min` (10-minute interval):

| Parameter | Description | Unit |
|---|---|---|
| `TL` | Air temperature | °C |
| `TLMAX` / `TLMIN` | Temp max / min (10 min) | °C |
| `RF` | Relative humidity | % |
| `P` / `PRED` | Station / reduced pressure | hPa |
| `DD` | Wind direction | ° |
| `FF` | Wind speed | m/s |
| `FFX` | Wind gust | m/s |
| `RR` | Precipitation (10 min) | mm |
| `SCHNEE` | Snow depth | cm |
| `SO` | Sunshine duration | sec |
| `GLOW` | Global radiation | W/m² |
| `TP` | Dew point temperature | °C |
| `TS` | 5cm air temperature | °C |
| `TB1`/`TB2`/`TB3` | Soil temp 10/20/50cm depth | °C |

### Station Filtering

Stations can be filtered by: name, ID, Austrian state (`Burgenland`, `Kärnten`, `Niederösterreich`, `Oberösterreich`, `Salzburg`, `Steiermark`, `Tirol`, `Vorarlberg`, `Wien`), altitude range, active status, date range, and sensor capabilities (sunshine, global radiation).

### MCP Helper Tools (Hiking-Optimized)

The GeoSphere MCP server provides high-level convenience tools built on top of the raw API:

- **`get_hike_forecast(lat, lon)`** — Hourly forecast (t2m, precip, wind, gusts, humidity, cloud cover) for a trailhead. Default 48h horizon, uses AROME nowcast.
- **`score_weather_window(lat, lon)`** — Ranks upcoming hours against ultralight hiking thresholds (precip <1mm/h, gusts <11m/s, temp -5..28°C). Returns scored contiguous windows.
- **`get_snow_conditions(lat, lon)`** — Combines SnowGrid (depth/SWE trend) with NWP forecast snow line. Shows whether snow is accumulating/melting and incoming snowfall elevation.
- **`get_alpine_temperature(lat, lon, target_elevation_m)`** — Lapse-rate-corrected temperature for a summit/col. Applies -6.5°C/1000m from model terrain to target elevation.
