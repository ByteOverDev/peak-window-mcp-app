import { describe, expect, it } from "vitest";
import { buildProfile } from "./openmeteo.ts";

const LEVELS = [1000, 925, 850];

// Minimal OpenMeteoHourly-shaped object: each pressure field is an array indexed by hour.
function hourly(over: Record<string, (number | null)[]> = {}) {
  return {
    time: ["2026-05-30T06:00"],
    geopotential_height_1000hPa: [110],
    geopotential_height_925hPa: [800],
    geopotential_height_850hPa: [1500],
    temperature_1000hPa: [12],
    temperature_925hPa: [8],
    temperature_850hPa: [3],
    wind_speed_1000hPa: [3.6], // km/h → 1 m/s
    wind_speed_925hPa: [18],
    wind_speed_850hPa: [36],
    wind_direction_1000hPa: [200],
    wind_direction_925hPa: [220],
    wind_direction_850hPa: [240],
    relative_humidity_1000hPa: [80],
    relative_humidity_925hPa: [60],
    relative_humidity_850hPa: [40],
    ...over,
  } as never;
}

describe("buildProfile", () => {
  it("assembles a sorted profile and converts wind km/h → m/s", () => {
    const p = buildProfile(hourly(), 0, LEVELS);
    expect(p).not.toBeNull();
    expect(p!.map((l) => l.geopotentialHeightM)).toEqual([110, 800, 1500]);
    expect(p![0].windMs).toBeCloseTo(1, 6); // 3.6 km/h
    expect(p![2].tempC).toBe(3);
    expect(p![1].rh).toBe(60);
  });

  it("drops levels with null geopotential height", () => {
    const p = buildProfile(hourly({ geopotential_height_925hPa: [null] }), 0, LEVELS);
    expect(p!.map((l) => l.pressureHPa)).toEqual([1000, 850]);
  });

  it("returns null when fewer than 2 levels are usable", () => {
    const p = buildProfile(
      hourly({ geopotential_height_925hPa: [null], geopotential_height_850hPa: [null] }),
      0,
      LEVELS,
    );
    expect(p).toBeNull();
  });

  it("sorts by height even when input order is inverted", () => {
    const p = buildProfile(
      hourly({
        geopotential_height_1000hPa: [1500],
        geopotential_height_850hPa: [110],
      }),
      0,
      LEVELS,
    );
    expect(p!.map((l) => l.geopotentialHeightM)).toEqual([110, 800, 1500]);
  });
});
