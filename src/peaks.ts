/**
 * Curated gazetteer of marquee summits worldwide.
 *
 * Lets the MCP tool resolve a peak *name* from chat ("Großglockner", "Mont Blanc")
 * to authoritative coordinates + summit elevation, instead of making the model
 * geocode and guess. This is intentionally NOT exhaustive — any peak not listed
 * here still works by passing lat/lon (and falls through to Open-Meteo globally).
 * The gazetteer only guarantees *correct* coords/elevation for the famous ones.
 */

export interface PeakEntry {
  name: string; // canonical display name
  aliases: string[]; // alternative / ascii-folded short forms (store normalized)
  lat: number;
  lon: number;
  elevationM: number;
  region: string; // display only
}

export const PEAKS: PeakEntry[] = [
  // Eastern Alps (GeoSphere coverage)
  { name: "Großglockner", aliases: ["grossglockner", "glockner"], lat: 47.0747, lon: 12.6939, elevationM: 3798, region: "Eastern Alps, Austria" },
  { name: "Großvenediger", aliases: ["grossvenediger", "venediger"], lat: 47.1092, lon: 12.3464, elevationM: 3657, region: "Eastern Alps, Austria" },
  { name: "Wildspitze", aliases: [], lat: 46.8853, lon: 10.8678, elevationM: 3768, region: "Ötztal Alps, Austria" },
  { name: "Triglav", aliases: [], lat: 46.3786, lon: 13.8369, elevationM: 2864, region: "Julian Alps, Slovenia" },
  { name: "Zugspitze", aliases: [], lat: 47.4211, lon: 10.9853, elevationM: 2962, region: "Wetterstein, Germany/Austria" },

  // Western Alps
  { name: "Mont Blanc", aliases: ["montblanc"], lat: 45.8326, lon: 6.8652, elevationM: 4808, region: "Graian Alps, France/Italy" },
  { name: "Matterhorn", aliases: ["cervino", "mont cervin"], lat: 45.9763, lon: 7.6586, elevationM: 4478, region: "Pennine Alps, Switzerland/Italy" },
  { name: "Monte Rosa", aliases: ["dufourspitze", "punta dufour"], lat: 45.9369, lon: 7.8669, elevationM: 4634, region: "Pennine Alps, Switzerland/Italy" },
  { name: "Eiger", aliases: [], lat: 46.5775, lon: 8.0053, elevationM: 3967, region: "Bernese Alps, Switzerland" },
  { name: "Jungfrau", aliases: [], lat: 46.5367, lon: 7.9625, elevationM: 4158, region: "Bernese Alps, Switzerland" },
  { name: "Gran Paradiso", aliases: ["grand paradis"], lat: 45.5169, lon: 7.2683, elevationM: 4061, region: "Graian Alps, Italy" },

  // Pyrenees
  { name: "Aneto", aliases: ["pico de aneto"], lat: 42.6319, lon: 0.6575, elevationM: 3404, region: "Pyrenees, Spain" },

  // Cascades / Rockies / Sierra (USA)
  { name: "Mount Rainier", aliases: ["mt rainier", "rainier"], lat: 46.8523, lon: -121.7603, elevationM: 4392, region: "Cascades, USA" },
  { name: "Mount Hood", aliases: ["mt hood", "hood"], lat: 45.3736, lon: -121.6960, elevationM: 3429, region: "Cascades, USA" },
  { name: "Mount Shasta", aliases: ["mt shasta", "shasta"], lat: 41.4092, lon: -122.1949, elevationM: 4322, region: "Cascades, USA" },
  { name: "Longs Peak", aliases: ["longs"], lat: 40.2549, lon: -105.6151, elevationM: 4346, region: "Rocky Mountains, USA" },
  { name: "Mount Whitney", aliases: ["mt whitney", "whitney"], lat: 36.5785, lon: -118.2923, elevationM: 4421, region: "Sierra Nevada, USA" },

  // Alaska / Canada
  { name: "Denali", aliases: ["mount mckinley", "mt mckinley", "mckinley"], lat: 63.0692, lon: -151.0070, elevationM: 6190, region: "Alaska Range, USA" },
  { name: "Mount Robson", aliases: ["mt robson", "robson"], lat: 53.1100, lon: -119.1559, elevationM: 3954, region: "Canadian Rockies, Canada" },

  // Andes
  { name: "Aconcagua", aliases: [], lat: -32.6532, lon: -70.0109, elevationM: 6961, region: "Andes, Argentina" },
  { name: "Chimborazo", aliases: [], lat: -1.4692, lon: -78.8175, elevationM: 6263, region: "Andes, Ecuador" },

  // Himalaya / Karakoram
  { name: "Mount Everest", aliases: ["everest", "sagarmatha", "chomolungma"], lat: 27.9881, lon: 86.9250, elevationM: 8849, region: "Himalaya, Nepal/China" },
  { name: "K2", aliases: ["mount godwin austen"], lat: 35.8808, lon: 76.5133, elevationM: 8611, region: "Karakoram, Pakistan/China" },
  { name: "Ama Dablam", aliases: [], lat: 27.8617, lon: 86.8614, elevationM: 6812, region: "Himalaya, Nepal" },

  // Africa / Japan
  { name: "Kilimanjaro", aliases: ["mount kilimanjaro", "uhuru peak"], lat: -3.0674, lon: 37.3556, elevationM: 5895, region: "Tanzania" },
  { name: "Mount Fuji", aliases: ["mt fuji", "fuji", "fujisan"], lat: 35.3606, lon: 138.7274, elevationM: 3776, region: "Honshū, Japan" },
];

/** Lowercase, strip diacritics (NFD + drop combining marks), collapse whitespace. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // drop combining diacritical marks
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const INDEX = new Map<string, PeakEntry>();
for (const peak of PEAKS) {
  INDEX.set(normalize(peak.name), peak);
  for (const alias of peak.aliases) INDEX.set(normalize(alias), peak);
}

/** Resolve a peak by name or alias (diacritic- and case-insensitive). Null if unknown. */
export function resolvePeak(query: string): PeakEntry | null {
  if (!query) return null;
  return INDEX.get(normalize(query)) ?? null;
}
