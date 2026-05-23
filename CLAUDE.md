# Weather MCP Project

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
