import type { SunMarker } from "./types.ts";

interface SunEvent { sunrise: number; sunset: number; }

export function computeSunEvents(startTs: number, hours: number, lat: number, lon: number): SunEvent[] {
  const events: SunEvent[] = [];
  const days = Math.ceil(hours / 24) + 1;
  const RAD = Math.PI / 180;
  for (let d = -1; d < days; d++) {
    const day = new Date((startTs + d * 86400) * 1000);
    day.setUTCHours(0, 0, 0, 0);
    const n = Math.ceil(day.getTime() / 86400000 - 10957.5 - lon / 360);
    const Jstar = 2451545.0 + n + 0.0009 - lon / 360;
    const M = (357.5291 + 0.98560028 * (Jstar - 2451545)) % 360;
    const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD);
    const lam = (M + C + 180 + 102.9372) % 360;
    const Jtransit = Jstar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lam * RAD);
    const decl = Math.asin(Math.sin(lam * RAD) * Math.sin(23.44 * RAD));
    const cosH = (Math.sin(-0.83 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) /
                 (Math.cos(lat * RAD) * Math.cos(decl));
    if (cosH < -1 || cosH > 1) continue;
    const H = (Math.acos(cosH) * 180) / Math.PI;
    events.push({
      sunrise: Math.round((Jtransit - H / 360 - 2440587.5) * 86400),
      sunset: Math.round((Jtransit + H / 360 - 2440587.5) * 86400),
    });
  }
  return events;
}

export function computeSunMarkers(times: number[], lat: number, lon: number): SunMarker[] {
  const days: Record<string, SunMarker> = {};
  for (const t of times) {
    const d = new Date(t * 1000);
    const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    if (!days[dayKey]) {
      const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
      const RAD = Math.PI / 180;
      const n = Math.ceil(dayStart / 86400 - 10957.5 - lon / 360);
      const Jstar = 2451545.0 + n + 0.0009 - lon / 360;
      const M = (357.5291 + 0.98560028 * (Jstar - 2451545)) % 360;
      const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD);
      const lam = (M + C + 180 + 102.9372) % 360;
      const Jtransit = Jstar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lam * RAD);
      const decl = Math.asin(Math.sin(lam * RAD) * Math.sin(23.44 * RAD));
      const cosH = (Math.sin(-0.83 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) /
                   (Math.cos(lat * RAD) * Math.cos(decl));
      if (cosH >= -1 && cosH <= 1) {
        const H = (Math.acos(cosH) * 180) / Math.PI;
        days[dayKey] = {
          dayStart,
          sunriseEpoch: Math.round((Jtransit - H / 360 - 2440587.5) * 86400),
          sunsetEpoch: Math.round((Jtransit + H / 360 - 2440587.5) * 86400),
        };
      }
    }
  }
  return Object.values(days);
}

export type { SunEvent };
