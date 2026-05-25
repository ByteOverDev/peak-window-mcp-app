/**
 * Test harness — renders the full PeakWindow UI with mock data,
 * bypassing the MCP SDK so we can visually verify in a browser.
 */
import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Clock, Cloud, MapPin, Moon, Thermometer } from "lucide-react";
import "./global.css";
import styles from "./mcp-app.module.css";
import vk from "./ventusky.module.css";
import type { CursorState, PeakWindowResult } from "./types.ts";
import { computeSunMarkers } from "./sun.ts";
import { TopBar } from "./components/TopBar.tsx";
import { HeroWindow } from "./components/HeroWindow.tsx";
import { MountainProfile } from "./components/MountainProfile.tsx";
import { ChartPanels, snowRelevant, type VentuskyPayload } from "./ventusky.tsx";
import { StatsRow } from "./components/StatsRow.tsx";
import { WeekOverview } from "./components/WeekOverview.tsx";
import { FloatingTooltip } from "./components/FloatingTooltip.tsx";
import { scoreHour, findWindows, type HourData } from "./scoring.ts";

function windChill(tC: number, vMs: number): number {
  const vKmh = vMs * 3.6;
  if (tC > 10 || vKmh < 4.8) return tC;
  const v16 = Math.pow(vKmh, 0.16);
  return 13.12 + 0.6215 * tC - 11.37 * v16 + 0.3965 * tC * v16;
}

function windDir(u: number, v: number): number {
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
}

function magnitude(u: number, v: number): number {
  return Math.sqrt(u * u + v * v);
}

// Real GeoSphere NWP forecast for Großglockner (47.0747°N, 12.6939°E)
// Fetched 2026-05-23T12:00Z, nwp-v1-1h-2500m, grid point [12.694, 47.067]
const GK_TIMESTAMPS = ["2026-05-23T17:00+00:00","2026-05-23T18:00+00:00","2026-05-23T19:00+00:00","2026-05-23T20:00+00:00","2026-05-23T21:00+00:00","2026-05-23T22:00+00:00","2026-05-23T23:00+00:00","2026-05-24T00:00+00:00","2026-05-24T01:00+00:00","2026-05-24T02:00+00:00","2026-05-24T03:00+00:00","2026-05-24T04:00+00:00","2026-05-24T05:00+00:00","2026-05-24T06:00+00:00","2026-05-24T07:00+00:00","2026-05-24T08:00+00:00","2026-05-24T09:00+00:00","2026-05-24T10:00+00:00","2026-05-24T11:00+00:00","2026-05-24T12:00+00:00","2026-05-24T13:00+00:00","2026-05-24T14:00+00:00","2026-05-24T15:00+00:00","2026-05-24T16:00+00:00","2026-05-24T17:00+00:00","2026-05-24T18:00+00:00","2026-05-24T19:00+00:00","2026-05-24T20:00+00:00","2026-05-24T21:00+00:00","2026-05-24T22:00+00:00","2026-05-24T23:00+00:00","2026-05-25T00:00+00:00","2026-05-25T01:00+00:00","2026-05-25T02:00+00:00","2026-05-25T03:00+00:00","2026-05-25T04:00+00:00","2026-05-25T05:00+00:00","2026-05-25T06:00+00:00","2026-05-25T07:00+00:00","2026-05-25T08:00+00:00","2026-05-25T09:00+00:00","2026-05-25T10:00+00:00","2026-05-25T11:00+00:00","2026-05-25T12:00+00:00","2026-05-25T13:00+00:00","2026-05-25T14:00+00:00","2026-05-25T15:00+00:00","2026-05-25T16:00+00:00","2026-05-25T17:00+00:00","2026-05-25T18:00+00:00","2026-05-25T19:00+00:00","2026-05-25T20:00+00:00","2026-05-25T21:00+00:00","2026-05-25T22:00+00:00","2026-05-25T23:00+00:00","2026-05-26T00:00+00:00"];
const GK_T2M = [3.3,2.4,1.7,1.3,0.9,0.6,0.4,0.5,0.4,0.4,0.5,0.4,0.6,1.5,2.3,3.2,3.2,3.5,3.7,4,4.1,4.4,4.5,4.6,4.3,3.8,3.2,2.5,2.9,3.3,3.2,2.8,2.3,1.9,1.9,1.7,2,2.9,3.8,4.2,4.3,4.3,4.8,5.2,5.4,5.4,5.5,5.5,5.4,4.9,4.3,3.9,3.7,4,3.8,3.7];
const GK_TCC = [0.4,0.1,0,0.1,0,0.3,0.4,0.2,0.1,0.1,0,0.3,0.6,0.1,0,0,0,0,0,0,0.1,0.1,0.1,0,0.1,0.4,1,1,1,1,1,1,0.5,0.4,0.1,0.1,0.2,0.2,0.2,0.4,0.5,0.1,0,0.5,0.5,0.6,0.2,0.1,0,0.1,0.1,0.1,0,0,0.1,0.1];
const GK_RR_ACC = [0,0.003,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001];
const GK_SNOW_ACC = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
const GK_SNOWLMT = [3214.6,3119.1,3153.5,3157,3117.1,3078.4,3113.7,3132.2,3126.6,3156.3,3190.3,3180.8,3169.3,3172.6,3177.5,3189.4,3226.5,3265.3,3291.2,3292.8,3246.7,3215.5,3240.7,3241.9,3223.2,3199.8,3193.5,3294.9,3273.4,3206,3169.1,3208.1,3133.4,3141.4,3166.9,3158.1,3182.4,3242.8,3318.7,3379.8,3382.9,3399.4,3437.1,3457.9,3476.7,3483,3506.7,3537.9,3584.3,3625.4,3658.9,3679,3676.5,3659.9,3636.7,3605.6];
const GK_U10M = [-2.6,-2,-2.6,-3.4,-3.2,-3.6,-4.1,-4.2,-4.2,-3.8,-3.6,-3.6,-3.6,-3.5,-3.4,-3.2,-3.3,-3.3,-3.3,-3,-2.4,-2.9,-2.4,-2.3,-2.4,-2.2,-2.2,-1.2,-0.9,-1.6,-1.8,-1.4,-1.1,-1.2,-0.9,-0.4,0,0.1,0.2,-0.1,-0.4,-0.7,-1.2,-1.5,-1.3,-1.2,-1.5,-1.2,-1.3,-1.4,-1.5,-1.6,-1.8,-1.7,-1.3,-1.4];
const GK_V10M = [-6.2,-5.7,-5.8,-5.4,-5.2,-5.4,-5.8,-6.5,-6.5,-6.5,-6.4,-6,-6,-5.9,-5.6,-5.4,-5.7,-5.5,-5.3,-5.5,-5.7,-5.5,-5.8,-6.2,-5.6,-4.8,-4.9,-4.9,-3.9,-5.5,-5.3,-5.1,-5.2,-5.5,-5.4,-5.4,-5.5,-5.8,-5.9,-5.7,-5.4,-5.3,-4.9,-4.2,-3.5,-3.7,-4.2,-4.3,-4.7,-5.2,-5.4,-5.1,-4.5,-3.5,-2.8,-2.6];
const GK_UGUST = [-4.6,-3.9,-5.2,-6.4,-6.7,-6.6,-7.5,-7.8,-8,-7.9,-7.2,-6.8,-6.8,-6.8,-6.6,-6.5,-6.3,-6.3,-6.4,-5.7,-5.1,-4.8,-5,-4.4,-4.5,-4.8,-4.5,-4.3,-2.5,-3.2,-3.7,-3.7,-2.4,-2.3,-2.2,-1.2,0,0.3,0.3,0.3,-0.2,-1,-1.4,-2.3,-3,-2.4,-3,-2.8,-2.4,-2.6,-2.8,-2.8,-3.1,-3.4,-3.2,-2.6];
const GK_VGUST = [-12.3,-12.3,-12.2,-10.5,-10.3,-10.2,-10.6,-11.7,-12.1,-12,-11.9,-11.8,-11.2,-11.1,-10.9,-10.5,-10.9,-10.7,-10.2,-10.1,-10.7,-11.4,-11.2,-12.1,-12,-10.8,-9.9,-10,-9.5,-10.7,-10.9,-10.5,-10.1,-10.5,-10.4,-10.6,-10.6,-11.2,-11.3,-11.3,-11,-10.3,-10,-9.2,-7.9,-7.1,-8,-8,-9.1,-9.6,-9.9,-9.9,-9.3,-8.1,-6.6,-5.2];

function deaccumulate(acc: number[]): number[] {
  return acc.map((v, i) => i === 0 ? 0 : Math.max(0, v - acc[i - 1]));
}

function generateMockData(): PeakWindowResult {
  const lat = 47.0747, lon = 12.6939;
  const summitElevationM = 3798, gridElevationM = 3093;
  const lapseDeltaC = (gridElevationM - summitElevationM) * 0.0065;
  const LAPSE_RATE = 0.0065;

  const rr = deaccumulate(GK_RR_ACC);
  const snow = deaccumulate(GK_SNOW_ACC);

  const rawHours: HourData[] = GK_TIMESTAMPS.map((time, i) => {
    const gridT = GK_T2M[i];
    const summitT = +(gridT + lapseDeltaC).toFixed(2);
    const wsp = +magnitude(GK_U10M[i], GK_V10M[i]).toFixed(2);
    const gust = +magnitude(GK_UGUST[i], GK_VGUST[i]).toFixed(2);
    const dd = +windDir(GK_U10M[i], GK_V10M[i]).toFixed(1);
    const snowlmt = Math.round(GK_SNOWLMT[i]);
    const fl = +windChill(summitT, wsp).toFixed(2);
    const fzLevel = Math.round(summitElevationM + summitT / LAPSE_RATE);
    const hasPrecip = rr[i] > 0.05 || snow[i] > 0.05;
    const precipType: HourData["precipType"] = !hasPrecip ? "none"
      : snowlmt + 100 < summitElevationM ? "snow"
      : snowlmt > summitElevationM + 100 ? "rain" : "mixed";

    return {
      time,
      t2m: summitT,
      rr: +rr[i].toFixed(2),
      wsp,
      gust,
      tcc: GK_TCC[i],
      snow: +snow[i].toFixed(2),
      snowlmt,
      dd,
      feelsLike: fl,
      freezingLevel: fzLevel,
      precipType,
    };
  });

  const scored = rawHours.map(scoreHour);
  const windows = findWindows(scored);

  const snowMm = rawHours.map(h => h.snow);
  const series = {
    time: rawHours.map(h => Math.floor(new Date(h.time).getTime() / 1000)),
    t2m: rawHours.map(h => h.t2m),
    ff: rawHours.map(h => h.wsp),
    fx: rawHours.map(h => h.gust),
    rr: rawHours.map(h => h.rr),
    snow: snowMm,
    snowFresh: snowMm.map(v => v == null ? null : (v * 10) / 10),
    snowlmt: rawHours.map(h => h.snowlmt),
    tcc: rawHours.map(h => h.tcc !== null ? h.tcc * 100 : null),
    dd: rawHours.map(h => h.dd),
    feelsLike: rawHours.map(h => h.feelsLike),
    freezingLevel: rawHours.map(h => h.freezingLevel),
    precipType: rawHours.map(h => h.precipType),
  };

  return {
    peakName: "Großglockner",
    summitElevationM,
    gridElevationM,
    lapseDeltaC: +lapseDeltaC.toFixed(2),
    lat, lon,
    gridLat: 47.067, gridLon: 12.694,
    gridResolutionKm: 2.5,
    issued_at: "2026-05-23T12:00:00.000Z",
    fetchedAt: new Date().toISOString(),
    source: "GeoSphere Austria — NWP 1h 2.5km",
    hours: scored,
    windows,
    series,
  };
}

function TestApp() {
  const [data] = useState(() => {
    const d = generateMockData();
    (window as unknown as Record<string, unknown>).__mockData = d;
    return d;
  });
  const [showNight, setShowNight] = useState(true);
  const [showCloud, setShowCloud] = useState(true);
  const [showFeelsLike, setShowFeelsLike] = useState(true);
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const sunMarkers = useMemo(() => computeSunMarkers(data.series.time, data.lat, data.lon), [data]);

  const handleTapeHover = useCallback((idx: number | null, x?: number, y?: number) => {
    if (idx == null) { setCursor(null); return; }
    setCursor({ idx, clientX: x ?? 0, clientY: y ?? 0, source: "tape" });
  }, []);

  const chartPayload: VentuskyPayload = useMemo(() => ({
    lat: data.lat,
    lon: data.lon,
    issued_at: data.issued_at,
    peakName: data.peakName,
    summitElevationM: data.summitElevationM,
    gridElevationM: data.gridElevationM,
    lapseDeltaC: data.lapseDeltaC,
    gridResolutionKm: data.gridResolutionKm,
    series: data.series,
    score: data.hours.map(h => h.score),
  }), [data]);

  const showSnow = snowRelevant(chartPayload);
  const snowlmtVals = showSnow ? data.series.snowlmt.filter((v): v is number => v != null) : [];
  const snowlmtMin = snowlmtVals.length ? Math.min(...snowlmtVals) : null;
  const snowlmtMax = snowlmtVals.length ? Math.max(...snowlmtVals) : null;

  const windows = data.windows;
  const selectedWindow = windows[selectedIdx] ?? windows[0];

  return (
    <div className={styles.embed}>
      <TopBar data={data} windowCount={windows.length} />

      <HeroWindow
        window={selectedWindow}
        hours={data.hours}
        sunMarkers={sunMarkers}
        totalHours={data.series.time.length}
        selectedIdx={selectedIdx}
        totalWindows={windows.length}
        peakName={data.peakName}
        lat={data.lat}
        lon={data.lon}
        summitElevation={data.summitElevationM}

        onPrev={() => setSelectedIdx(Math.max(0, selectedIdx - 1))}
        onNext={() => setSelectedIdx(Math.min(windows.length - 1, selectedIdx + 1))}
      />

      <WeekOverview
        hours={data.hours}
        windows={windows}
        selectedIdx={selectedIdx}
        onSelect={setSelectedIdx}
        cursorIdx={cursor?.idx ?? null}
        onHover={handleTapeHover}
      />

      <div className={styles.forecast}>
        <div className={vk.header}>
          <div className={vk.headerLeft}>
            <h3 className={vk.title}>Forecast detail</h3>
            <div className={vk.meta}>window {selectedIdx + 1} of {windows.length}</div>
            <div className={vk.meta}><MapPin size={11} />{data.lat.toFixed(3)}, {data.lon.toFixed(3)}</div>
            <div className={vk.meta}><Clock size={11} />issued {new Date(data.issued_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</div>
          </div>
          <div className={vk.toggles}>
            <button className={vk.toggle} aria-pressed={showFeelsLike} onClick={() => setShowFeelsLike(v => !v)}>
              <Thermometer size={13} /> Feels-like
            </button>
            <button className={vk.toggle} aria-pressed={showNight} onClick={() => setShowNight(v => !v)}>
              <Moon size={13} /> Night
            </button>
            <button className={vk.toggle} aria-pressed={showCloud} onClick={() => setShowCloud(v => !v)}>
              <Cloud size={13} /> Cloud
            </button>
          </div>
        </div>

        <div className={vk.lapseLine}>
          {data.lapseDeltaC != null && (
            <>
              <span>
                Lapse-corrected <strong>{data.lapseDeltaC.toFixed(1)}&deg;C</strong>
                <span className={vk.lapseSep}> from grid </span>
                <strong>{Math.round(data.gridElevationM!)} m</strong>
                <span className={vk.lapseSep}> &rarr; summit </span>
                <strong>{data.summitElevationM} m</strong>
              </span>
              <span className={vk.lapseSep}>&middot;</span>
            </>
          )}
          <span>{data.gridResolutionKm} km grid</span>
          {snowlmtMin != null && snowlmtMax != null && (
            <>
              <span className={vk.lapseSep}>&middot;</span>
              <span>
                Snow line <strong>{(snowlmtMin / 1000).toFixed(1)} km</strong> &rarr; <strong>{(snowlmtMax / 1000).toFixed(1)} km</strong>
              </span>
            </>
          )}
        </div>

        <div className={vk.forecastBody}>
          <MountainProfile data={data} cursorIdx={cursor?.idx ?? null} />
          <ChartPanels
            payload={chartPayload}
            showNight={showNight}
            showCloud={showCloud}
            showFeelsLike={showFeelsLike}
            onCursor={setCursor}
            externalCursorIdx={cursor?.source === "tape" ? cursor.idx : null}
          />
        </div>

        <StatsRow data={data} />

        <div className={vk.source}>
          Source: {data.source} &middot; fetched {new Date(data.fetchedAt).toLocaleString()}
        </div>
      </div>

      <FloatingTooltip data={data} cursor={cursor} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <TestApp />,
);
