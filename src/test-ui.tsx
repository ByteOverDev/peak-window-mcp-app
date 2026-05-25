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
// Fetched 2026-05-25T03:00Z, nwp-v1-1h-2500m, grid point [12.694, 47.067]
const GK_TIMESTAMPS = ["2026-05-25T06:00+00:00","2026-05-25T07:00+00:00","2026-05-25T08:00+00:00","2026-05-25T09:00+00:00","2026-05-25T10:00+00:00","2026-05-25T11:00+00:00","2026-05-25T12:00+00:00","2026-05-25T13:00+00:00","2026-05-25T14:00+00:00","2026-05-25T15:00+00:00","2026-05-25T16:00+00:00","2026-05-25T17:00+00:00","2026-05-25T18:00+00:00","2026-05-25T19:00+00:00","2026-05-25T20:00+00:00","2026-05-25T21:00+00:00","2026-05-25T22:00+00:00","2026-05-25T23:00+00:00","2026-05-26T00:00+00:00","2026-05-26T01:00+00:00","2026-05-26T02:00+00:00","2026-05-26T03:00+00:00","2026-05-26T04:00+00:00","2026-05-26T05:00+00:00","2026-05-26T06:00+00:00","2026-05-26T07:00+00:00","2026-05-26T08:00+00:00","2026-05-26T09:00+00:00","2026-05-26T10:00+00:00","2026-05-26T11:00+00:00","2026-05-26T12:00+00:00","2026-05-26T13:00+00:00","2026-05-26T14:00+00:00","2026-05-26T15:00+00:00","2026-05-26T16:00+00:00","2026-05-26T17:00+00:00","2026-05-26T18:00+00:00","2026-05-26T19:00+00:00","2026-05-26T20:00+00:00","2026-05-26T21:00+00:00","2026-05-26T22:00+00:00","2026-05-26T23:00+00:00","2026-05-27T00:00+00:00","2026-05-27T01:00+00:00","2026-05-27T02:00+00:00","2026-05-27T03:00+00:00","2026-05-27T04:00+00:00","2026-05-27T05:00+00:00","2026-05-27T06:00+00:00","2026-05-27T07:00+00:00","2026-05-27T08:00+00:00","2026-05-27T09:00+00:00","2026-05-27T10:00+00:00","2026-05-27T11:00+00:00","2026-05-27T12:00+00:00","2026-05-27T13:00+00:00","2026-05-27T14:00+00:00","2026-05-27T15:00+00:00"];
const GK_T2M = [3.7,4.4,4.5,4.6,4.9,5.2,5.5,5.7,5.8,5.7,5.4,5.3,5,4.4,4.2,4,3.9,4,3.9,3.7,3.6,3.5,3.4,3.9,4.9,5.6,5.7,5.8,6,6.3,6.6,7.1,7.1,6.7,6.9,6.8,6.3,5.5,5,4.6,4.2,4.3,4,3.9,3.7,3.6,3.2,3.4,4.1,4.5,4.6,4.7,5,5.1,5.4,5.7,5.7,5.7];
const GK_TCC = [0.3,0.2,0.1,0.1,0,0,0,0,0.1,0.1,0.2,0.2,0.2,0.2,0.1,0,0,0,0.1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.5,0,0,0.1,0,0,0,0,0.1,0.2,0.4,0.7,0.4,0.1,0.1,0,1];
const GK_RR_ACC = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
const GK_SNOW_ACC = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
const GK_SNOWLMT = [3264.8,3266.1,3281.1,3317.9,3376.2,3412.5,3464.5,3504.3,3523.6,3541.6,3573.9,3596.8,3606.7,3658,3694.4,3696.5,3661.9,3626.8,3607.9,3584.5,3552.1,3535.1,3542.5,3551.6,3550.1,3560.5,3566.4,3557.2,3570.5,3579.9,3600.4,3645.5,3662.9,3653.5,3651.4,3667,3656.9,3639.8,3628.1,3633.3,3610.8,3580.5,3556.3,3538,3527.9,3524.6,3484,3455.6,3402.8,3381.4,3370,3355.7,3305,3291.6,3356.4,3323.7,3369.9,3308.7];
const GK_U10M = [-0.5,-1,-1.2,-0.9,-0.6,-0.7,-1.1,-1,-0.9,-0.8,-0.6,-0.6,-0.4,-0.8,-0.9,-1.1,-1.1,-1.1,-0.7,-0.5,-0.5,-0.4,-0.4,-0.3,-0.3,-0.1,0.1,0,0.4,0.7,0.8,0.5,0.1,0,0.2,0.1,0.2,0.4,0.6,0.7,0.9,1.4,1.9,2.2,2.3,2,2.2,2.4,2.7,3.3,3.3,2.8,1.8,2.9,2.5,2.4,2.5,2.3];
const GK_V10M = [-3.2,-3.9,-3.8,-2.9,-1.1,-1,-1.8,-2.3,-2.9,-3.9,-4.6,-4.9,-4.8,-5.1,-4.7,-4.1,-3.5,-3,-2.1,-1.8,-1.7,-1.6,-1.4,-1.2,-0.9,-0.6,-0.4,-0.3,-0.4,-0.6,-0.9,-1.5,-2.1,-2.8,-3,-3.2,-2.9,-2.5,-2.3,-1.9,-1.7,-2,-2.1,-2.5,-3,-3.5,-4,-4.6,-4.7,-5,-4.9,-4.9,-4.7,-5,-5.6,-5.5,-6.2,-6];
const GK_UGUST = [-1.9,-2.1,-2.6,-2.7,-2.2,-1.4,-2.2,-1.9,-1.7,-1.5,-1.2,-1.2,-1.1,-1.6,-1.7,-1.9,-2.3,-2.2,-2,-1.1,-0.8,-0.7,-0.6,-0.5,-0.3,-0.3,-0.2,-0.1,0.3,0.8,0.9,0.7,0,-0.1,0.3,0.2,0.3,0.3,0.9,1.3,1.3,2.3,3.4,4.1,4.3,3.8,4.3,4.6,5.3,6.4,6.5,6.1,5.7,5.9,5,5.7,5.2,3.4];
const GK_VGUST = [-9.8,-7.9,-8.3,-7.7,-6,-2.6,-3.6,-4.4,-5.4,-7.2,-8.2,-8.8,-8.9,-9.4,-9.6,-8.9,-7.8,-6.6,-5.5,-3.9,-3,-2.7,-2.5,-2.1,-1.6,-1.2,-0.7,-0.5,-0.4,-0.8,-1.3,-2.4,-3.7,-5.1,-5.6,-6.1,-6,-5.5,-4.6,-4.1,-3.4,-3.8,-3.8,-4.6,-5.5,-6.6,-7.6,-8.7,-9,-9.6,-9.6,-9.6,-9.5,-9.9,-11.1,-11.5,-12.6,-13.4];

function deaccumulate(acc: number[]): number[] {
  return acc.map((v, i) => i === 0 ? 0 : Math.max(0, v - acc[i - 1]));
}

function generateMockData(): PeakWindowResult {
  const lat = 47.0747, lon = 12.6939;
  const summitElevationM = 3798, gridElevationM = 2654;
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
    issued_at: "2026-05-25T03:00:00.000Z",
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
