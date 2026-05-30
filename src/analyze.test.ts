import { describe, expect, it } from "vitest";
import { analyzeForecast } from "./analyze.ts";
import { LAPSE_RATE_C_PER_M } from "./profile-interp.ts";
import type { HourData, VerticalLevel } from "./scoring.ts";
import type { ForecastProviderResult } from "./providers/types.ts";

function hour(time: string, over: Partial<HourData> = {}): HourData {
  return {
    time,
    t2m: 10, rr: 0, wsp: 3, gust: 4, tcc: 0.2,
    snow: 0, snowlmt: 2500, dd: 270,
    feelsLike: null, freezingLevel: null, precipType: "none",
    ...over,
  };
}

function result(hours: HourData[], gridElevationM: number | null): ForecastProviderResult {
  return {
    hours,
    gridLat: 47, gridLon: 12,
    gridElevationM,
    gridResolutionKm: 2,
    providerId: "test",
    source: "test",
  };
}

const profile: VerticalLevel[] = [
  { pressureHPa: 925, geopotentialHeightM: 800, tempC: 8, windMs: 4, windDir: 270, rh: 50 },
  { pressureHPa: 850, geopotentialHeightM: 1500, tempC: 3, windMs: 10, windDir: 280, rh: 40 },
  { pressureHPa: 700, geopotentialHeightM: 3000, tempC: -6, windMs: 20, windDir: 290, rh: 30 },
];

const times = ["2026-05-30T05:00:00Z", "2026-05-30T06:00:00Z", "2026-05-30T07:00:00Z"];

describe("analyzeForecast — profile interpolation", () => {
  it("uses profile interpolation for summit temp when a profile is present", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, profile }));
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12, summitElevationM: 2000 });
    expect(r.interpMethod).toBe("profile");
    // 2000 m lies between 1500 m (3°C) and 3000 m (-6°C)
    const expected = 3 + (-6 - 3) * ((2000 - 1500) / (3000 - 1500));
    expect(r.hours[0].t2m).toBeCloseTo(expected, 6);
    expect(r.lapseNote).toContain("profile-interpolated");
  });
});

describe("analyzeForecast — fixed-lapse fallback (GeoSphere regression guard)", () => {
  it("reproduces the old lapse formula when no profile is present", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, profile: null }));
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12, summitElevationM: 2000 });
    expect(r.interpMethod).toBe("lapse");
    // old applyLapseCorrection: t2m + (grid - summit) * LAPSE
    expect(r.hours[0].t2m).toBeCloseTo(10 + (500 - 2000) * LAPSE_RATE_C_PER_M, 6);
    expect(r.lapseNote).toContain("lapse-corrected");
  });

  it("leaves interpMethod null when no summit elevation is supplied", () => {
    const hours = times.map((t) => hour(t));
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12 });
    expect(r.interpMethod).toBeNull();
    expect(r.hours[0].t2m).toBe(10);
    expect(r.bands).toEqual([]);
  });
});

describe("analyzeForecast — elevation bands", () => {
  it("emits base/mid/summit bands; summit band equals corrected hours", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, profile }));
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12, summitElevationM: 2000 });
    expect(r.bands.map((b) => b.label)).toEqual(["base", "mid", "summit"]);
    // summit band is the scored hours themselves — every per-hour field matches exactly
    const summit = r.bands.at(-1)!;
    expect(summit.t2m).toEqual(r.hours.map((h) => h.t2m));
    expect(summit.feelsLike).toEqual(r.hours.map((h) => h.feelsLike));
    expect(summit.freezingLevel).toEqual(r.hours.map((h) => h.freezingLevel));
  });

  it("strips the bulky pressure-level profile from returned hours (no response bloat)", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, profile }));
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12, summitElevationM: 2000 });
    for (const h of r.hours) expect(h.profile).toBeUndefined();
  });

  it("lower bands are warmer than the summit under a normal profile", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, profile }));
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12, summitElevationM: 2000 });
    const base = r.bands.find((b) => b.label === "base")!;
    const summit = r.bands.find((b) => b.label === "summit")!;
    expect(base.t2m[0]!).toBeGreaterThan(summit.t2m[0]!);
  });

  it("keeps an explicit base that sits between mid and summit (not silently dropped)", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, profile }));
    // base 1700 is above mid (summit-600 = 1400) but still below summit 2000
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12, summitElevationM: 2000, baseElevationM: 1700 });
    const base = r.bands.find((b) => b.label === "base");
    expect(base?.elevationM).toBe(1700);
    // mid (1400) is below the explicit base, so it is not emitted
    expect(r.bands.map((b) => b.label)).toEqual(["base", "summit"]);
  });

  it("skips an inverted base/col at or above the summit instead of emitting a bogus band", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, profile }));
    const r = analyzeForecast(result(hours, 500), {
      lat: 47, lon: 12, summitElevationM: 2000, baseElevationM: 3000, colElevationM: 2500,
    });
    expect(r.bands.every((b) => b.elevationM < 2000 || b.label === "summit")).toBe(true);
    expect(r.bands.map((b) => b.label)).not.toContain("col");
  });

  it("adds a col band when colElevationM is supplied", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, profile }));
    const r = analyzeForecast(result(hours, 500), {
      lat: 47, lon: 12, summitElevationM: 2000, colElevationM: 1800,
    });
    expect(r.bands.map((b) => b.label)).toContain("col");
    expect(r.bands.find((b) => b.label === "col")!.elevationM).toBe(1800);
  });
});

describe("analyzeForecast — profile-aware wind", () => {
  it("overrides summit wind speed AND direction from the profile but keeps the provider gust", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, wsp: 3, gust: 4, dd: 180, profile }));
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12, summitElevationM: 2000 });
    // 2000 m between 1500 m and 3000 m → t = 1/3
    const t = (2000 - 1500) / (3000 - 1500);
    expect(r.hours[0].wsp).toBeCloseTo(10 + (20 - 10) * t, 6); // speed interpolated
    expect(r.hours[0].dd).toBeCloseTo(280 + (290 - 280) * t, 4); // direction interpolated (280→290)
    expect(r.hours[0].gust).toBe(4); // gust untouched
  });

  it("interpolates summit wind direction the short way across 0/360", () => {
    const wrapProfile: VerticalLevel[] = [
      { pressureHPa: 850, geopotentialHeightM: 1500, tempC: 3, windMs: 10, windDir: 350, rh: 40 },
      { pressureHPa: 700, geopotentialHeightM: 3000, tempC: -6, windMs: 20, windDir: 10, rh: 30 },
    ];
    const hours = times.map((t) => hour(t, { t2m: 10, dd: 180, profile: wrapProfile }));
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12, summitElevationM: 2000 });
    // 350→10 short way passes through 360/0, not back through 180; at t=1/3 → ~356.7°
    expect(r.hours[0].dd!).toBeGreaterThan(350);
    expect(r.hours[0].dd!).toBeLessThanOrEqual(360);
  });

  it("leaves wind untouched when there is no profile (provider 10m wind)", () => {
    const hours = times.map((t) => hour(t, { t2m: 10, wsp: 3, gust: 4, profile: null }));
    const r = analyzeForecast(result(hours, 500), { lat: 47, lon: 12, summitElevationM: 2000 });
    expect(r.hours[0].wsp).toBe(3);
    expect(r.hours[0].gust).toBe(4);
  });
});
