import { describe, expect, it } from "vitest";
import { resolvePeak } from "./peaks.ts";

describe("resolvePeak", () => {
  it("resolves a canonical name", () => {
    const p = resolvePeak("Großglockner");
    expect(p?.name).toBe("Großglockner");
    expect(p?.elevationM).toBe(3798);
  });

  it("resolves an alias", () => {
    expect(resolvePeak("glockner")?.name).toBe("Großglockner");
    expect(resolvePeak("mont cervin")?.name).toBe("Matterhorn");
  });

  it("is diacritic- and case-insensitive", () => {
    expect(resolvePeak("grossglockner")?.name).toBe("Großglockner");
    expect(resolvePeak("MONT BLANC")?.name).toBe("Mont Blanc");
    expect(resolvePeak("  wildspitze  ")?.name).toBe("Wildspitze");
  });

  it("returns null for unknown peaks and empty input", () => {
    expect(resolvePeak("Nonexistent Hill")).toBeNull();
    expect(resolvePeak("")).toBeNull();
  });
});
