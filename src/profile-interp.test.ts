import { describe, expect, it } from "vitest";
import {
  circularLerp,
  interpolateAtElevation,
  LAPSE_RATE_C_PER_M,
  type InterpFallback,
} from "./profile-interp.ts";
import type { VerticalLevel } from "./scoring.ts";

function level(over: Partial<VerticalLevel> & Pick<VerticalLevel, "geopotentialHeightM">): VerticalLevel {
  return {
    pressureHPa: 850,
    tempC: 0,
    windMs: 5,
    windDir: 270,
    rh: 50,
    ...over,
  };
}

const fb = (over: Partial<InterpFallback> = {}): InterpFallback => ({
  t2m: 10,
  gridElevationM: 500,
  windMs: 3,
  windDir: 180,
  ...over,
});

describe("circularLerp", () => {
  it("takes the short way across 360/0", () => {
    expect(circularLerp(350, 10, 0.5)).toBeCloseTo(0, 6);
  });
  it("interpolates linearly within a hemisphere", () => {
    expect(circularLerp(90, 180, 0.5)).toBeCloseTo(135, 6);
  });
});

describe("interpolateAtElevation — fallback", () => {
  it("uses fixed lapse from grid t2m when no profile (matches old formula)", () => {
    const r = interpolateAtElevation(null, 2500, fb({ t2m: 10, gridElevationM: 500 }));
    expect(r.method).toBe("lapse-fallback");
    // old applyLapseCorrection: t2m + (grid - target) * LAPSE
    expect(r.tempC).toBeCloseTo(10 + (500 - 2500) * LAPSE_RATE_C_PER_M, 6);
  });

  it("falls back when profile has fewer than 2 levels", () => {
    const r = interpolateAtElevation([level({ geopotentialHeightM: 1500 })], 2500, fb());
    expect(r.method).toBe("lapse-fallback");
  });

  it("passes wind through untouched on fallback", () => {
    const r = interpolateAtElevation(null, 2500, fb({ windMs: 7, windDir: 200 }));
    expect(r.windMs).toBe(7);
    expect(r.windDir).toBe(200);
  });
});

describe("interpolateAtElevation — profile", () => {
  const standard = [
    level({ pressureHPa: 925, geopotentialHeightM: 800, tempC: 8, windMs: 4 }),
    level({ pressureHPa: 850, geopotentialHeightM: 1500, tempC: 3, windMs: 10 }),
    level({ pressureHPa: 700, geopotentialHeightM: 3000, tempC: -6, windMs: 20 }),
  ];

  it("interpolates temperature linearly in geopotential height", () => {
    // target 1150 m is halfway between 800 m (8°C) and 1500 m (3°C)
    const r = interpolateAtElevation(standard, 1150, fb());
    expect(r.method).toBe("profile");
    expect(r.tempC).toBeCloseTo(8 + (3 - 8) * ((1150 - 800) / (1500 - 800)), 6);
    expect(r.windMs).toBeCloseTo(4 + (10 - 4) * ((1150 - 800) / (1500 - 800)), 6);
  });

  it("captures an inversion (warmer aloft) — result sits between levels, not lapse-extrapolated", () => {
    const inversion = [
      level({ geopotentialHeightM: 800, tempC: -2 }),  // cold valley
      level({ geopotentialHeightM: 1500, tempC: 5 }),  // warm above
    ];
    const r = interpolateAtElevation(inversion, 1150, fb());
    expect(r.method).toBe("profile");
    expect(r.tempC).toBeGreaterThan(-2);
    expect(r.tempC).toBeLessThan(5);
    // A monotonic lapse from a -2°C/800m valley would predict colder at 1150 m;
    // the profile gives warmer, proving inversion capture.
    expect(r.tempC!).toBeGreaterThan(-2 + (800 - 1150) * LAPSE_RATE_C_PER_M);
  });

  it("extrapolates with lapse above the highest level", () => {
    const r = interpolateAtElevation(standard, 4000, fb());
    expect(r.method).toBe("lapse-extrapolate");
    expect(r.tempC).toBeCloseTo(-6 + (3000 - 4000) * LAPSE_RATE_C_PER_M, 6);
  });

  it("extrapolates with lapse below the lowest level", () => {
    const r = interpolateAtElevation(standard, 400, fb());
    expect(r.method).toBe("lapse-extrapolate");
    expect(r.tempC).toBeCloseTo(8 + (800 - 400) * LAPSE_RATE_C_PER_M, 6);
  });
});
