import { describe, expect, it } from "vitest";
import { geosphereProvider } from "./geosphere.ts";
import { meteoSwissProvider, meteoFranceProvider } from "./openmeteo.ts";

// Representative peaks: [name, lat, lon]
const MATTERHORN = [45.9763, 7.6586] as const;   // Swiss/Italian — 7.66°E
const MONT_BLANC = [45.8326, 6.8652] as const;   // French — 6.87°E
const GROSSGLOCKNER = [47.0747, 12.6939] as const; // Austrian — 12.69°E
const WILDSPITZE = [46.8853, 10.8678] as const;  // Austrian (Ötztal) — 10.87°E

describe("provider routing — GeoSphere is Austria-centric", () => {
  it("does NOT claim Swiss/French western-Alps peaks", () => {
    expect(geosphereProvider.covers(...MATTERHORN)).toBe(false);
    expect(geosphereProvider.covers(...MONT_BLANC)).toBe(false);
  });

  it("still claims Austrian / Eastern-Alps peaks", () => {
    expect(geosphereProvider.covers(...GROSSGLOCKNER)).toBe(true);
    expect(geosphereProvider.covers(...WILDSPITZE)).toBe(true);
  });

  it("hands western-Alps peaks to MeteoSwiss (next in router order)", () => {
    // MeteoSwiss has priority over GeoSphere here only because GeoSphere now abstains.
    expect(meteoSwissProvider.covers(...MATTERHORN)).toBe(true);
    expect(meteoFranceProvider.covers(...MONT_BLANC)).toBe(true);
  });
});
