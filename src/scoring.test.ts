import { describe, expect, it } from "vitest";
import { scoreHour, scoreWindow, type HourData, type ScoredHour } from "./scoring.ts";

// Minimal benign hour; override fields per test.
function hour(over: Partial<HourData> = {}): ScoredHour {
  const base: HourData = {
    time: "2026-05-30T06:00:00Z",
    t2m: 5, rr: 0, wsp: 2, gust: 3, tcc: 0.2,
    snow: 0, snowlmt: 2000, dd: 270,
    feelsLike: 5, freezingLevel: 4500, precipType: "none",
  };
  return scoreHour({ ...base, ...over });
}

describe("scoreWindow hard vetoes", () => {
  it("caps score at 30 when any hour has gust >= 20 m/s", () => {
    const slice = [hour(), hour(), hour({ gust: 22, feelsLike: 5 })];
    const { score } = scoreWindow(slice);
    expect(score).toBeLessThanOrEqual(30);
  });

  it("caps score at 30 when any hour has precip >= 2.0 mm/h", () => {
    const slice = [hour(), hour({ rr: 2.5 })];
    const { score } = scoreWindow(slice);
    expect(score).toBeLessThanOrEqual(30);
  });

  it("scores a calm window highly", () => {
    const slice = [hour(), hour(), hour(), hour()];
    const { score } = scoreWindow(slice);
    expect(score).toBeGreaterThanOrEqual(80);
  });
});

describe("scoreHour bands", () => {
  it("penalizes a brisk-wind hour below a calm one", () => {
    expect(hour({ gust: 11, wsp: 11 }).score).toBeLessThan(hour().score);
  });

  it("heavily penalizes and flags a dangerous-wind hour", () => {
    const h = hour({ gust: 25, wsp: 25 });
    expect(h.score).toBeLessThanOrEqual(40);
    expect(h.reasons.some((r) => r.includes("dangerous wind"))).toBe(true);
  });
});
