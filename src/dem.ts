/**
 * Fetches a real elevation silhouette for a peak from Open-Meteo's Elevation API
 * (Copernicus DEM 90m) — the same source the baked Großglockner profile came from.
 *
 * Returns normalized 0..1 ridge profiles matching the contract the mountain
 * backdrop expects: a front W→E transect through the summit and a back ridge
 * ~2 km north, plus the column index of the highest point.
 *
 * Browser-safe: only fetch/URL/Math, so it runs in both the MCP server and the
 * static showcase page.
 */

export interface PeakProfile {
  profile: number[]; // front ridge, normalized 0..1 (1 = highest sampled point)
  backProfile: number[]; // back ridge ~2km north, same normalization
  peakIdx: number; // index of the summit column in `profile`
}

const COLUMNS = 80;
const SPAN_KM = 14; // E→W extent of the transect
const BACK_OFFSET_KM = 2; // back ridge distance north
const KM_PER_DEG_LAT = 111.32;
const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
const TIMEOUT_MS = 8000;

function transect(lat: number, lon: number, atLat: number): { lats: number[]; lons: number[] } {
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const halfSpanDeg = SPAN_KM / 2 / Math.max(kmPerDegLon, 1e-6);
  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    const t = i / (COLUMNS - 1);
    lats.push(atLat);
    lons.push(lon - halfSpanDeg + t * 2 * halfSpanDeg);
  }
  return { lats, lons };
}

async function fetchElevations(lats: number[], lons: number[]): Promise<number[]> {
  const url = new URL(ELEVATION_URL);
  url.searchParams.set("latitude", lats.join(","));
  url.searchParams.set("longitude", lons.join(","));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Elevation API error ${res.status}`);
    const json = (await res.json()) as { elevation: (number | null)[] };
    return json.elevation.map((e) => e ?? 0);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Elevation API timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch and normalize the real elevation silhouette for a peak. */
export async function fetchPeakProfile(lat: number, lon: number): Promise<PeakProfile> {
  const front = transect(lat, lon, lat);
  const back = transect(lat, lon, lat + BACK_OFFSET_KM / KM_PER_DEG_LAT);

  const [frontEl, backEl] = await Promise.all([
    fetchElevations(front.lats, front.lons),
    fetchElevations(back.lats, back.lons),
  ]);

  const all = [...frontEl, ...backEl];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min;
  const norm = (e: number) => (span > 0 ? (e - min) / span : 0.5);

  let peakIdx = 0;
  for (let i = 1; i < frontEl.length; i++) {
    if (frontEl[i] > frontEl[peakIdx]) peakIdx = i;
  }

  return {
    profile: frontEl.map(norm),
    backProfile: backEl.map(norm),
    peakIdx,
  };
}
