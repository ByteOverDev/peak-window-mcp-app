import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { CloudRain, Snowflake, Thermometer, Wind } from "lucide-react";
import type { CursorState } from "./types.ts";
import { computeSunEvents, type SunEvent } from "./sun.ts";
import styles from "./ventusky.module.css";

export interface VentuskySeries {
  time: number[];
  t2m: (number | null)[];
  ff: (number | null)[];
  fx: (number | null)[];
  rr: (number | null)[];
  snow: (number | null)[];
  snowFresh: (number | null)[];
  snowlmt: (number | null)[];
  tcc: (number | null)[];
  dd: (number | null)[];
  feelsLike: (number | null)[];
  freezingLevel: (number | null)[];
  precipType: ("none" | "rain" | "snow" | "mixed")[];
}

export interface VentuskyPayload {
  lat: number;
  lon: number;
  issued_at: string;
  peakName?: string | null;
  summitElevationM?: number | null;
  gridElevationM?: number | null;
  lapseDeltaC?: number | null;
  gridResolutionKm?: number | null;
  series: VentuskySeries;
  score?: (number | null)[];
}

export function snowRelevant(p: VentuskyPayload): boolean {
  if (p.series.snow?.some((v) => v != null && v > 0)) return true;
  const snowlmtVals = p.series.snowlmt?.filter((v): v is number => v != null);
  if (!snowlmtVals?.length) return false;
  const summit = p.summitElevationM;
  if (summit == null) return true;
  return Math.min(...snowlmtVals) <= summit;
}

// Resolve CSS custom properties to canvas-usable color values.
// `light-dark()` is understood by CSS but NOT by Canvas 2D, so we
// resolve via a hidden probe element once per theme, then cache.
const _varCache = new Map<string, string>();
let _probe: HTMLElement | null = null;
let _schemeListener = false;

function _resolveVar(name: string): string {
  if (!_probe) {
    _probe = document.createElement("div");
    _probe.style.display = "none";
    document.body.appendChild(_probe);
  }
  _probe.style.color = `var(${name})`;
  return getComputedStyle(_probe).color;
}

function _invalidateCache() {
  _varCache.clear();
}

function cssVar(name: string): string {
  if (!_schemeListener) {
    _schemeListener = true;
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", _invalidateCache);
  }
  let val = _varCache.get(name);
  if (val == null) {
    val = _resolveVar(name);
    _varCache.set(name, val);
  }
  return val;
}

const SYNC_KEY = "peakwindow-sync";

function fillNightRegions(ctx: CanvasRenderingContext2D, u: uPlot, sun: SunEvent[], minT: number, maxT: number) {
  ctx.fillStyle = cssVar("--night-fill");
  let cursor = minT;
  for (const e of sun) {
    if (e.sunrise > cursor && e.sunrise <= maxT) {
      const x0 = u.valToPos(cursor, "x", true);
      const x1 = u.valToPos(Math.min(e.sunrise, maxT), "x", true);
      ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
    }
    cursor = Math.max(cursor, e.sunset);
  }
  if (cursor < maxT) {
    const x0 = u.valToPos(cursor, "x", true);
    const x1 = u.valToPos(maxT, "x", true);
    ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
  }
}

function drawSunLines(ctx: CanvasRenderingContext2D, u: uPlot, sun: SunEvent[], minT: number, maxT: number) {
  ctx.strokeStyle = cssVar("--c-sun");
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.45;
  ctx.setLineDash([3, 3]);
  for (const e of sun) {
    for (const ts of [e.sunrise, e.sunset]) {
      if (ts < minT || ts > maxT) continue;
      const x = Math.round(u.valToPos(ts, "x", true)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, u.bbox.top);
      ctx.lineTo(x, u.bbox.top + u.bbox.height);
      ctx.stroke();
    }
  }
}

function nightBandsHook(sun: SunEvent[], on: () => boolean) {
  return (u: uPlot) => {
    if (!on()) return;
    const ctx = u.ctx;
    ctx.save();
    const minT = u.data[0][0] as number;
    const maxT = u.data[0][u.data[0].length - 1] as number;
    fillNightRegions(ctx, u, sun, minT, maxT);
    drawSunLines(ctx, u, sun, minT, maxT);
    ctx.restore();
  };
}

function cloudBandHook(on: () => boolean, dataIdx = 2) {
  return (u: uPlot) => {
    if (!on()) return;
    const cloud = u.data[dataIdx];
    if (!cloud) return;
    const ctx = u.ctx;
    ctx.save();
    const stripH = 14;
    const cloudColor = cssVar("--c-cloud");
    const top = u.bbox.top + 2;
    ctx.fillStyle = cloudColor;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(u.bbox.left, top, u.bbox.width, stripH);
    for (let i = 0; i < cloud.length; i++) {
      const v = cloud[i];
      if (v == null) continue;
      const x0 = u.valToPos(u.data[0][i] as number, "x", true);
      const x1 = i + 1 < cloud.length
        ? u.valToPos(u.data[0][i + 1] as number, "x", true)
        : x0 + 4;
      const frac = Math.max(0, Math.min(1, (v as number) / 100));
      ctx.globalAlpha = frac === 0 ? 0 : 0.15 + frac * 0.8;
      ctx.fillRect(x0, top, x1 - x0, stripH);
    }
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = cssVar("--grid-axis");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(u.bbox.left, top + stripH + 0.5);
    ctx.lineTo(u.bbox.left + u.bbox.width, top + stripH + 0.5);
    ctx.stroke();
    ctx.restore();
  };
}

function windArrowHook(ddIdx: number) {
  return (u: uPlot) => {
    const dd = u.data[ddIdx];
    if (!dd) return;
    const ctx = u.ctx;
    ctx.save();
    const arrowSize = 7;
    const stripH = 16;
    const top = u.bbox.top + 3;
    const cy = top + stripH / 2;
    const color = cssVar("--c-wind");

    const minGap = 20;
    let lastX = -Infinity;
    for (let i = 0; i < dd.length; i++) {
      const deg = dd[i];
      if (deg == null) continue;
      const x = u.valToPos(u.data[0][i] as number, "x", true);
      if (x - lastX < minGap) continue;
      lastX = x;

      const rad = ((deg as number + 180) * Math.PI) / 180;
      ctx.save();
      ctx.translate(x, cy);
      ctx.rotate(rad);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -arrowSize);
      ctx.lineTo(arrowSize * 0.45, arrowSize * 0.5);
      ctx.lineTo(0, arrowSize * 0.2);
      ctx.lineTo(-arrowSize * 0.45, arrowSize * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  };
}

function cursorLineHook() {
  return (u: uPlot) => {
    const idx = u.cursor.idx;
    if (idx == null) return;
    const x = u.valToPos(u.data[0][idx] as number, "x", true);
    const ctx = u.ctx;
    ctx.save();
    ctx.strokeStyle = cssVar("--text-muted");
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, u.bbox.top);
    ctx.lineTo(Math.round(x) + 0.5, u.bbox.top + u.bbox.height);
    ctx.stroke();
    ctx.restore();
  };
}


function drawSnowFill(ctx: CanvasRenderingContext2D, u: uPlot, summitM: number, times: ArrayLike<number | null | undefined>, snowlmt: ArrayLike<number | null | undefined>) {
  const ySummit = u.valToPos(summitM, "m", true);
  ctx.save();
  ctx.fillStyle = cssVar("--c-snowlmt");
  ctx.globalAlpha = 0.13;
  ctx.beginPath();
  let inFill = false;
  for (let i = 0; i < times.length; i++) {
    const sl = snowlmt[i];
    if (sl == null) { inFill = false; continue; }
    if ((sl as number) < summitM) {
      const x = u.valToPos(times[i] as number, "x", true);
      const y = u.valToPos(sl as number, "m", true);
      if (!inFill) { ctx.moveTo(x, ySummit); inFill = true; }
      ctx.lineTo(x, y);
    } else if (inFill) {
      ctx.lineTo(u.valToPos(times[i] as number, "x", true), ySummit);
      inFill = false;
    }
  }
  if (inFill) {
    ctx.lineTo(u.valToPos(times[times.length - 1] as number, "x", true), ySummit);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSummitLabel(ctx: CanvasRenderingContext2D, u: uPlot, summitM: number) {
  const scale = u.scales["m"];
  if (!scale || summitM < (scale.min ?? 0) || summitM > (scale.max ?? Infinity)) return;
  const ySummit = u.valToPos(summitM, "m", true);
  ctx.save();
  ctx.strokeStyle = cssVar("--text-muted");
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(u.bbox.left, ySummit);
  ctx.lineTo(u.bbox.left + u.bbox.width, ySummit);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = cssVar("--text-muted");
  ctx.font = "600 9.5px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`SUMMIT ${summitM}m`, u.bbox.left + 6, ySummit - 2);
  ctx.restore();
}

function summitFillHook(summitM: number): (u: uPlot) => void {
  return (u) => {
    const scale = u.scales["m"];
    if (!scale || scale.min == null || scale.max == null) return;
    const snowlmt = u.data[2];
    if (!snowlmt) return;
    drawSnowFill(u.ctx, u, summitM, u.data[0], snowlmt);
    drawSummitLabel(u.ctx, u, summitM);
  };
}

const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "numeric", day: "numeric" });
const fmtHour = new Intl.DateTimeFormat(undefined, { hour: "numeric", hour12: true });

function fmtTimeAxis(_u: uPlot, splits: number[]) {
  return splits.map((t) => {
    const d = new Date(t * 1000);
    if (d.getHours() === 0 && d.getMinutes() === 0) return fmtDate.format(d);
    return fmtHour.format(d).replace(/\s/g, "").toLowerCase();
  });
}

function axisX(showLabels = true): uPlot.Axis {
  return {
    stroke: () => cssVar("--text-faint"),
    grid: { stroke: () => cssVar("--grid"), width: 1 },
    ticks: { show: false },
    space: 70,
    size: showLabels ? 36 : 0,
    values: fmtTimeAxis,
    font: "11px ui-sans-serif, system-ui, sans-serif",
    show: showLabels,
  };
}

function axisY(opts: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: () => cssVar("--text-faint"),
    grid: { stroke: () => cssVar("--grid"), width: 1 },
    ticks: { show: false },
    size: 40,
    font: "11px ui-sans-serif, system-ui, sans-serif",
    ...opts,
  };
}

interface PanelSpec {
  title: string;
  height: number;
  data: uPlot.AlignedData;
  opts: Omit<uPlot.Options, "width" | "height">;
}

function tempPanel(p: VentuskyPayload, sun: SunEvent[], showNight: () => boolean, showCloud: () => boolean, showFeelsLike: () => boolean): PanelSpec {
  const cTemp = cssVar("--c-temp");
  const cTempFill = cssVar("--c-temp-fill");
  const cFeels = cssVar("--c-feels");
  return {
    title: "Temperature",
    height: 150,
    data: [p.series.time, p.series.t2m, p.series.feelsLike, p.series.tcc] as uPlot.AlignedData,
    opts: {
      cursor: { sync: { key: SYNC_KEY }, drag: { x: false, y: false }, points: { show: false } },
      scales: { x: { time: true }, t: { auto: true } },
      legend: { show: false },
      series: [
        {},
        { label: "Temp", scale: "t", stroke: cTemp, fill: cTempFill, width: 2 },
        { label: "Feels-like", scale: "t", stroke: cFeels, width: 1.5, dash: [4, 4], points: { show: false },
          show: showFeelsLike() && (p.series.feelsLike?.some((v) => v != null) ?? false) },
        { label: "Cloud", scale: "c", show: false },
      ],
      axes: [axisX(false), axisY({ scale: "t", values: (_u, v) => v.map((x) => `${Math.round(x as number)}°`), size: 40 })],
      hooks: { draw: [nightBandsHook(sun, showNight), cloudBandHook(showCloud, 3), cursorLineHook()] },
    },
  };
}

function precipPanel(p: VentuskyPayload, sun: SunEvent[], showNight: () => boolean): PanelSpec {
  const cPrecip = cssVar("--c-precip");
  const cPrecipFill = cssVar("--c-precip-fill");
  return {
    title: "Precipitation",
    height: 90,
    data: [p.series.time, p.series.rr] as uPlot.AlignedData,
    opts: {
      cursor: { sync: { key: SYNC_KEY }, drag: { x: false, y: false }, points: { show: false } },
      scales: { x: { time: true }, p: { range: (_u, _min, max) => [0, Math.max(2, (max ?? 0) * 1.2)] as uPlot.Range.MinMax } },
      legend: { show: false },
      series: [
        {},
        { label: "Precip", scale: "p", stroke: cPrecip, fill: cPrecipFill,
          paths: uPlot.paths!.bars!({ size: [0.65, 80] }), points: { show: false }, width: 0 },
      ],
      axes: [axisX(false), axisY({ scale: "p", values: (_u, v) => v.map((x) => `${(x as number).toFixed(x as number >= 1 ? 0 : 1)}`), size: 40, space: 30 })],
      hooks: { draw: [nightBandsHook(sun, showNight), cursorLineHook()] },
    },
  };
}

function snowPanel(p: VentuskyPayload, sun: SunEvent[], showNight: () => boolean): PanelSpec {
  const snowMax = Math.max(2, Math.max(...p.series.snow.filter((v): v is number => v != null)) * 1.3);
  const snowlmtVals = p.series.snowlmt.filter((v): v is number => v != null);
  const fzVals = p.series.freezingLevel?.filter((v): v is number => v != null) ?? [];
  const allLineVals = [...snowlmtVals, ...fzVals];
  const minLine = allLineVals.length ? Math.min(...allLineVals) : 2000;
  const maxLine = allLineVals.length ? Math.max(...allLineVals) : 3000;
  const summitM = p.summitElevationM ?? Infinity;
  const yLineMin = Math.max(0, Math.min(minLine, summitM) - 400);
  const yLineMax = Math.max(maxLine, summitM === Infinity ? 0 : summitM) + 400;

  const drawHooks: Array<(u: uPlot) => void> = [nightBandsHook(sun, showNight)];
  if (p.summitElevationM != null) drawHooks.push(summitFillHook(p.summitElevationM));
  drawHooks.push(cursorLineHook());

  const hasFz = fzVals.length > 0;

  return {
    title: "Snow",
    height: 130,
    data: [p.series.time, p.series.snow, p.series.snowlmt, ...(hasFz ? [p.series.freezingLevel] : [])] as uPlot.AlignedData,
    opts: {
      cursor: { sync: { key: SYNC_KEY }, drag: { x: false, y: false }, points: { show: false } },
      scales: {
        x: { time: true },
        y: { range: () => [0, snowMax] as uPlot.Range.MinMax },
        m: { range: () => [yLineMin, yLineMax] as uPlot.Range.MinMax },
      },
      legend: { show: false },
      series: [
        {},
        { label: "Snow", scale: "y", stroke: cssVar("--c-snow"), fill: cssVar("--c-snow-fill"),
          paths: uPlot.paths!.bars!({ size: [0.65, 80] }), points: { show: false }, width: 0 },
        { label: "Snow line", scale: "m", stroke: cssVar("--c-snowlmt"), width: 1.5, dash: [4, 4], points: { show: false } },
        ...(hasFz ? [{ label: "0°C", scale: "m", stroke: cssVar("--c-feels"), width: 1.2, dash: [1.5, 3], points: { show: false } } as uPlot.Series] : []),
      ],
      axes: [
        axisX(false),
        axisY({ scale: "y", values: (_u, v) => v.map((x) => `${(x as number).toFixed(x as number >= 1 ? 0 : 1)}`), size: 40, space: 30 }),
        axisY({ scale: "m", side: 1, size: 46, space: 40, values: (_u, v) => v.map((x) => `${((x as number) / 1000).toFixed(1)}k`) }),
      ],
      hooks: { draw: drawHooks },
    },
  };
}

function windPanel(p: VentuskyPayload, sun: SunEvent[], showNight: () => boolean): PanelSpec {
  const cWind = cssVar("--c-wind");
  const cGust = cssVar("--c-gust");
  return {
    title: "Wind",
    height: 110,
    data: [p.series.time, p.series.ff, p.series.fx, p.series.dd] as uPlot.AlignedData,
    opts: {
      cursor: { sync: { key: SYNC_KEY }, drag: { x: false, y: false }, points: { show: false } },
      scales: { x: { time: true }, w: { auto: true } },
      legend: { show: false },
      series: [
        {},
        { label: "Wind", scale: "w", stroke: cWind, width: 2, points: { show: false } },
        { label: "Gust", scale: "w", stroke: cGust, width: 1.5, dash: [4, 4], points: { show: false } },
        { label: "Dir", scale: "d", show: false },
      ],
      axes: [axisX(true), axisY({ scale: "w", values: (_u, v) => v.map((x) => `${(x as number).toFixed(0)}`), size: 40, space: 30 })],
      hooks: { draw: [nightBandsHook(sun, showNight), windArrowHook(3), cursorLineHook()] },
    },
  };
}


// ── Mountain backdrop ───────────────────────────────────────
const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const mtnCompass = (deg: number) => COMPASS[Math.round(((deg % 360 + 360) % 360) / 22.5) % 16];

// Skyline envelope: max elevation across 7 latitude rows through Großglockner massif.
// 80 columns W→E, ~14km span. Source: Open-Meteo Elevation API (Copernicus DEM 90m).
const GK_PROFILE = [
  0.6865, 0.5928, 0.5381, 0.4601, 0.4042, 0.3309, 0.3249, 0.3075, 0.3129, 0.2853,
  0.2721, 0.1730, 0.0468, 0.0000, 0.0529, 0.1315, 0.2492, 0.3015, 0.3664, 0.3544,
  0.4060, 0.4781, 0.5351, 0.5814, 0.6216, 0.6486, 0.6667, 0.6913, 0.7321, 0.8018,
  0.8679, 0.8565, 0.8571, 0.8607, 0.8913, 0.8961, 0.9952, 0.9706, 0.8883, 1.0000,
  0.9694, 0.9345, 0.8949, 0.8631, 0.8018, 0.7574, 0.7009, 0.6517, 0.6643, 0.6733,
  0.7057, 0.7015, 0.6901, 0.6763, 0.6330, 0.5742, 0.5135, 0.4727, 0.4565, 0.5063,
  0.5550, 0.5742, 0.5369, 0.5856, 0.4931, 0.4162, 0.4042, 0.3556, 0.2498, 0.1904,
  0.2228, 0.2583, 0.3459, 0.3712, 0.3760, 0.4054, 0.4733, 0.5231, 0.6126, 0.6330,
];
const GK_PEAK_IDX = 39;

// Back ridge: real elevation at 47.093°N (~2km north), same longitude span.
const GK_BACK_PROFILE = [
  0.4444, 0.5423, 0.5273, 0.4336, 0.4186, 0.3988, 0.3808, 0.3790, 0.3147, 0.2342,
  0.1093, 0.0000, 0.0000, 0.0288, 0.1285, 0.2126, 0.3153, 0.3826, 0.4120, 0.4024,
  0.4348, 0.4745, 0.5934, 0.6498, 0.6913, 0.7219, 0.7483, 0.7664, 0.8258, 0.8468,
  0.8048, 0.7730, 0.7459, 0.7153, 0.6643, 0.6030, 0.5712, 0.5598, 0.5495, 0.5339,
  0.5105, 0.4745, 0.3814, 0.2739, 0.2408, 0.2342, 0.2264, 0.2138, 0.2060, 0.2168,
  0.2763, 0.3544, 0.3892, 0.3694, 0.3844, 0.4408, 0.4378, 0.4342, 0.4685, 0.5556,
  0.6468, 0.5850, 0.5165, 0.4925, 0.5051, 0.4967, 0.4727, 0.3862, 0.3033, 0.2925,
  0.3285, 0.3568, 0.3988, 0.4162, 0.4745, 0.4264, 0.4234, 0.4883, 0.5243, 0.5694,
];

// ── Animated cloud layer for mountain backdrop ─────────────
interface CloudBlob {
  x: number;
  y: number;
  r: number;
  baseAlpha: number;
  speed: number;
  // each cloud is a cluster of soft circles with offsets
  lobes: { dx: number; dy: number; r: number }[];
}

function makeLobes(): CloudBlob["lobes"] {
  const n = 4 + Math.floor(Math.random() * 4);
  const lobes: CloudBlob["lobes"] = [];
  for (let i = 0; i < n; i++) {
    lobes.push({
      dx: (Math.random() - 0.5) * 1.6,
      dy: (Math.random() - 0.5) * 0.8,
      r: 0.5 + Math.random() * 0.6,
    });
  }
  return lobes;
}

function CloudLayer({ tcc, windSpeed }: { tcc: number; windSpeed: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobsRef = useRef<CloudBlob[]>([]);
  const rafRef = useRef(0);
  const tccRef = useRef(tcc);
  const windRef = useRef(windSpeed);
  tccRef.current = tcc;
  windRef.current = windSpeed;

  const spawnBlobs = useCallback((cover: number) => {
    const frac = Math.max(0, Math.min(1, cover / 100));
    const count = Math.round(4 + frac * 12);
    const blobs: CloudBlob[] = [];
    for (let i = 0; i < count; i++) {
      blobs.push({
        x: Math.random() * 1.4 - 0.2,
        y: 0.25 + Math.random() * 0.25,
        r: 0.045 + Math.random() * 0.045,
        baseAlpha: 0.10 + frac * (0.14 + Math.random() * 0.10),
        speed: 0.5 + Math.random() * 0.8,
        lobes: makeLobes(),
      });
    }
    return blobs;
  }, []);

  useEffect(() => {
    blobsRef.current = spawnBlobs(tcc);
  }, [Math.round(tcc / 10)]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTime = 0;
    const animate = (time: number) => {
      const dt = lastTime ? (time - lastTime) / 1000 : 0.016;
      lastTime = time;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * 2 || canvas.height !== h * 2) {
        canvas.width = w * 2;
        canvas.height = h * 2;
        ctx.scale(2, 2);
      }

      ctx.clearRect(0, 0, w, h);

      const cover = tccRef.current;
      const wind = windRef.current;
      const frac = Math.max(0, Math.min(1, cover / 100));
      if (frac < 0.05) { rafRef.current = requestAnimationFrame(animate); return; }

      const drift = (0.008 + wind * 0.004) * dt;

      for (const b of blobsRef.current) {
        b.x += drift * b.speed;
        if (b.x - b.r * 2 > 1.2) b.x = -0.2 - b.r * 2;

        const cx = b.x * w;
        const cy = b.y * h;
        const baseR = b.r * w;
        const alpha = b.baseAlpha * frac;

        for (const lobe of b.lobes) {
          const lx = cx + lobe.dx * baseR;
          const ly = cy + lobe.dy * baseR;
          const lr = lobe.r * baseR;
          const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
          grad.addColorStop(0, `rgba(220, 225, 235, ${alpha})`);
          grad.addColorStop(0.5, `rgba(215, 220, 230, ${alpha * 0.6})`);
          grad.addColorStop(1, `rgba(210, 215, 225, 0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} className={styles.mtnClouds} />;
}

// ── Rain/snow particles + lightning (Ventusky-style trails) ──
interface Droplet {
  x: number;
  y: number;
  speed: number;
  len: number;
  opacity: number;
}

function spawnDroplet(isSnow: boolean, intensity: number): Droplet {
  return {
    x: Math.random() * 1.3 - 0.15,
    y: -Math.random() * 0.3,
    speed: isSnow ? 0.06 + Math.random() * 0.10 : 0.3 + Math.random() * 0.5,
    len: isSnow ? 0 : 0.015 + intensity * 0.015 + Math.random() * 0.01,
    opacity: 0.2 + intensity * (0.3 + Math.random() * 0.2),
  };
}

function resetDroplet(d: Droplet) {
  d.y = -0.02 - Math.random() * 0.1;
  d.x = Math.random() * 1.3 - 0.15;
}

function drawSnowDot(ctx: CanvasRenderingContext2D, px: number, py: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(230, 235, 245, 0.9)";
  ctx.beginPath();
  ctx.arc(px, py, 1.2 + Math.random() * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRainStreak(ctx: CanvasRenderingContext2D, px: number, py: number, d: Droplet, windDrift: number, w: number, h: number, alpha: number, intensity: number) {
  const trailLen = d.len * h;
  const dx = windDrift * d.len * w * 0.4;
  const grad = ctx.createLinearGradient(px, py - trailLen, px + dx, py);
  grad.addColorStop(0, `rgba(170, 200, 235, 0)`);
  grad.addColorStop(0.3, `rgba(180, 210, 240, ${alpha * 0.4})`);
  grad.addColorStop(1, `rgba(200, 220, 250, ${alpha})`);
  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.2 + intensity * 0.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(px - dx * 0.3, py - trailLen * 0.8);
  ctx.lineTo(px + dx, py);
  ctx.stroke();
  ctx.fillStyle = `rgba(210, 225, 250, ${alpha * 1.2})`;
  ctx.beginPath();
  ctx.arc(px + dx, py, 0.8 + intensity * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLightningBolt(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) {
  ctx.save();
  ctx.fillStyle = `rgba(220, 230, 255, ${alpha * 0.15})`;
  ctx.fillRect(0, 0, w, h);
  if (alpha > 0.5) {
    const bx = 0.2 + Math.random() * 0.6;
    ctx.strokeStyle = `rgba(200, 210, 255, ${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(180, 200, 255, 0.8)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    let lx = bx * w;
    let ly = 0.05 * h;
    ctx.moveTo(lx, ly);
    const segs = 5 + Math.floor(Math.random() * 4);
    for (let s = 0; s < segs; s++) {
      lx += (Math.random() - 0.5) * 30;
      ly += (0.06 + Math.random() * 0.04) * h;
      ctx.lineTo(lx, ly);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function PrecipLayer({ precip, precipType, windSpeed, isThunder }: {
  precip: number; precipType: string; windSpeed: number; isThunder: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dropsRef = useRef<Droplet[]>([]);
  const rafRef = useRef(0);
  const precipRef = useRef(precip);
  const typeRef = useRef(precipType);
  const windRef = useRef(windSpeed);
  const thunderRef = useRef(isThunder);
  precipRef.current = precip;
  typeRef.current = precipType;
  windRef.current = windSpeed;
  thunderRef.current = isThunder;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTime = 0;
    let flashAlpha = 0;
    let nextFlash = 2000 + Math.random() * 4000;
    let elapsed = 0;

    const animate = (time: number) => {
      const dt = lastTime ? (time - lastTime) / 1000 : 0.016;
      lastTime = time;
      elapsed += dt * 1000;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * 2 || canvas.height !== h * 2) {
        canvas.width = w * 2;
        canvas.height = h * 2;
        ctx.scale(2, 2);
      }
      ctx.clearRect(0, 0, w, h);

      const rr = precipRef.current;
      const pType = typeRef.current;
      const wind = windRef.current;
      const intensity = Math.min(1, rr / 4);

      if (rr > 0.05) {
        const isSnow = pType === "snow";
        const isMixed = pType === "mixed";
        const windDrift = Math.min(0.5, wind * 0.03);
        const count = Math.round(60 + intensity * 340);

        while (dropsRef.current.length < count) dropsRef.current.push(spawnDroplet(isSnow, intensity));
        if (dropsRef.current.length > count) dropsRef.current.length = count;

        for (const d of dropsRef.current) {
          d.y += d.speed * (isSnow ? 0.8 : 2.8) * dt;
          d.x += windDrift * dt * (isSnow ? 0.4 : 1.2);
          if (isSnow) d.x += Math.sin(time * 0.0015 + d.y * 8) * 0.0004;
          if (d.y > 0.62 || d.x > 1.15) resetDroplet(d);

          const px = d.x * w;
          const py = d.y * h;
          const alpha = d.opacity * intensity;

          if (isSnow || (isMixed && d.speed < 0.12)) {
            drawSnowDot(ctx, px, py, alpha);
          } else {
            drawRainStreak(ctx, px, py, d, windDrift, w, h, alpha, intensity);
          }
        }
      } else {
        dropsRef.current.length = 0;
      }

      if (thunderRef.current && rr > 0.05) {
        if (elapsed > nextFlash) {
          flashAlpha = 0.7 + Math.random() * 0.3;
          nextFlash = elapsed + 1500 + Math.random() * 5000;
        }
        if (flashAlpha > 0) {
          drawLightningBolt(ctx, w, h, flashAlpha);
          flashAlpha *= 0.85;
          if (flashAlpha < 0.02) flashAlpha = 0;
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} className={styles.mtnClouds} />;
}

function MountainBackdrop({ payload, cursorIdx }: { payload: VentuskyPayload; cursorIdx: number | null }) {
  const summit = payload.summitElevationM;
  if (summit == null) return null;

  const snowlmt = payload.series.snowlmt;
  const dd = payload.series.dd;
  const idx = cursorIdx ?? 0;
  const currentSnow = snowlmt[idx] ?? snowlmt[0] ?? summit;
  const windDeg = dd[idx] ?? null;
  const tcc = (payload.series.tcc[idx] ?? 0) as number;
  const windSpeed = (payload.series.ff[idx] ?? 0) as number;
  const precip = (payload.series.rr[idx] ?? 0) as number;
  const precipType = payload.series.precipType[idx] ?? "none";
  const gust = (payload.series.fx[idx] ?? 0) as number;
  const isThunder = precip >= 2.0 && gust >= 12;

  const W = 1000, H = 900;
  const peakY = 140;
  const baseY = 480;

  const ridgePts = useMemo(() => {
    const pts: [number, number][] = [];
    pts.push([-30, baseY + 40]);
    for (let i = 0; i < GK_PROFILE.length; i++) {
      const x = (i / (GK_PROFILE.length - 1)) * W;
      const y = baseY - GK_PROFILE[i] * (baseY - peakY);
      pts.push([x, y]);
    }
    pts.push([W + 30, baseY + 40]);
    return pts;
  }, []);

  const ridgePath = `M ${ridgePts[0][0]},${ridgePts[0][1]} ` +
    ridgePts.slice(1).map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const backRidgePts = useMemo(() => {
    const pts: [number, number][] = [];
    pts.push([-30, baseY + 40]);
    for (let i = 0; i < GK_BACK_PROFILE.length; i++) {
      const x = (i / (GK_BACK_PROFILE.length - 1)) * W;
      const y = baseY - GK_BACK_PROFILE[i] * (baseY - peakY - 40);
      pts.push([x, y]);
    }
    pts.push([W + 30, baseY + 40]);
    return pts;
  }, []);
  const backRidgePath = `M ${backRidgePts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ")}`;

  const snowFrac = Math.max(0.04, Math.min(0.82, (summit - (currentSnow as number)) / summit));
  const snowY = peakY + snowFrac * (baseY - peakY);

  const peakName = payload.peakName ?? "Summit";

  return (
    <div className={styles.mtnBackdrop} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.mtnSvg}>
        <defs>
          <linearGradient id="mtnBack" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--c-snowlmt)" stopOpacity="0.06" />
            <stop offset="60%"  stopColor="var(--surface-2)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--surface)"   stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="mtnRock" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--surface-3)" stopOpacity="0.95" />
            <stop offset="55%"  stopColor="var(--surface-2)" stopOpacity="0.75" />
            <stop offset="92%"  stopColor="var(--surface)"   stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--surface)"   stopOpacity="0" />
          </linearGradient>
          <linearGradient id="mtnSnow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--c-snowlmt)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--c-snow)"    stopOpacity="0.20" />
          </linearGradient>
          <clipPath id="mtnRidgeClip">
            <path d={`${ridgePath} L ${W + 30},${baseY + 40} L -30,${baseY + 40} Z`} />
          </clipPath>
        </defs>

        <path d={`${backRidgePath} L ${W + 30},${baseY + 40} L -30,${baseY + 40} Z`}
              fill="url(#mtnBack)" />

        <path d={`${ridgePath} L ${W + 30},${baseY + 40} L -30,${baseY + 40} Z`}
              fill="url(#mtnRock)" />

        <g clipPath="url(#mtnRidgeClip)">
          <rect x="-30" y={-40} width={W + 60} height={snowY + 40} fill="url(#mtnSnow)"
                style={{ transition: "height 360ms ease" }} />
          <rect x="-30" y={snowY - 6} width={W + 60} height="12" fill="var(--c-snowlmt)"
                opacity="0.18" style={{ transition: "y 360ms ease" }} />
        </g>

        <path d={ridgePath} fill="none"
              stroke="var(--border-strong)" strokeWidth="0.8" strokeOpacity="0.55"
              strokeLinejoin="round" />

        <g clipPath="url(#mtnRidgeClip)">
          <line x1="0" y1={snowY} x2={W} y2={snowY}
                stroke="var(--c-snowlmt)" strokeWidth="0.7"
                strokeDasharray="4 5" opacity="0.40"
                style={{ transition: "y1 360ms ease, y2 360ms ease" }} />
        </g>
      </svg>

      <CloudLayer tcc={tcc} windSpeed={windSpeed} />
      <PrecipLayer precip={precip} precipType={precipType} windSpeed={windSpeed} isThunder={isThunder} />

      <div className={styles.mtnPeakZone} style={{ left: `${(GK_PEAK_IDX / (GK_PROFILE.length - 1)) * 100}%` }}>
        <div className={styles.mtnPeakWind}>
          {windDeg != null && (
            <div
              className={styles.mtnPeakVane}
              style={{ transform: `rotate(${(windDeg + 180) % 360}deg)` }}
            >
              <svg viewBox="0 0 16 18">
                <path d="M 8 1 L 13 15 L 8 12 L 3 15 Z" fill="var(--c-wind)" />
              </svg>
            </div>
          )}
          {windDeg != null && (
            <span className={styles.mtnPeakDir}>{mtnCompass(windDeg)}</span>
          )}
        </div>
        <div className={styles.mtnPeakName}>{peakName}</div>
      </div>
    </div>
  );
}

function findCursorIdx(charts: uPlot[], e: MouseEvent): number | null {
  for (const pl of charts) {
    const rect = pl.over.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right) continue;
    if (e.clientY < rect.top || e.clientY > rect.bottom) continue;
    return pl.cursor.idx ?? null;
  }
  return null;
}

interface ChartPanelsProps {
  payload: VentuskyPayload;
  showNight: boolean;
  showCloud: boolean;
  showFeelsLike?: boolean;
  onCursor: (cursor: CursorState | null) => void;
  externalCursorIdx: number | null;
}

export function ChartPanels({ payload, showNight, showCloud, showFeelsLike = true, onCursor, externalCursorIdx }: ChartPanelsProps) {
  const refs = {
    temp: useRef<HTMLDivElement>(null),
    precip: useRef<HTMLDivElement>(null),
    snow: useRef<HTMLDivElement>(null),
    wind: useRef<HTMLDivElement>(null),
  };
  const plotsRef = useRef<uPlot[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const showNightRef = useRef(showNight);
  const showCloudRef = useRef(showCloud);
  const showFeelsLikeRef = useRef(showFeelsLike);
  const onCursorRef = useRef(onCursor);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  showNightRef.current = showNight;
  showCloudRef.current = showCloud;
  showFeelsLikeRef.current = showFeelsLike;
  onCursorRef.current = onCursor;

  useEffect(() => {
    const hasSnow = snowRelevant(payload);

    const containers = [
      refs.temp.current,
      refs.precip.current,
      hasSnow ? refs.snow.current : null,
      refs.wind.current,
    ].filter((e): e is HTMLDivElement => !!e);

    const sun = computeSunEvents(payload.series.time[0], payload.series.time.length, payload.lat, payload.lon);
    const w = Math.max(320, containers[0]?.clientWidth ?? 320);

    const specs: PanelSpec[] = [
      tempPanel(payload, sun, () => showNightRef.current, () => showCloudRef.current, () => showFeelsLikeRef.current),
      precipPanel(payload, sun, () => showNightRef.current),
    ];
    if (hasSnow) specs.push(snowPanel(payload, sun, () => showNightRef.current));
    specs.push(windPanel(payload, sun, () => showNightRef.current));

    const charts = specs.map((p, i) => {
      const opts: uPlot.Options = { ...p.opts, width: w, height: p.height };
      return new uPlot(opts, p.data, containers[i]);
    });

    plotsRef.current = charts;

    const onMove = (e: MouseEvent) => {
      const idx = findCursorIdx(charts, e);
      if (idx != null) {
        setHoverIdx(idx);
        onCursorRef.current({ idx, clientX: e.clientX, clientY: e.clientY, source: "chart" });
      } else {
        setHoverIdx(null);
        onCursorRef.current(null);
      }
    };
    const onLeave = () => { setHoverIdx(null); onCursorRef.current(null); };
    const root = containerRef.current;
    if (root) {
      root.addEventListener("mousemove", onMove);
      root.addEventListener("mouseleave", onLeave);
    }

    const onResize = () => {
      const nw = Math.max(320, containers[0]?.clientWidth ?? 320);
      charts.forEach((u, i) => u.setSize({ width: nw, height: specs[i].height }));
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (root) {
        root.removeEventListener("mousemove", onMove);
        root.removeEventListener("mouseleave", onLeave);
      }
      charts.forEach((c) => c.destroy());
      plotsRef.current = [];
    };
  }, [payload]);

  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    const tempPlot = plotsRef.current[0];
    if (tempPlot) tempPlot.setSeries(2, { show: showFeelsLike }, false);
    plotsRef.current.forEach((c) => c.redraw());
  }, [showNight, showCloud, showFeelsLike]);

  useEffect(() => {
    if (externalCursorIdx == null) return;
    for (const p of plotsRef.current) {
      const t = p.data[0][externalCursorIdx];
      if (t == null) continue;
      const left = p.valToPos(t as number, "x");
      p.setCursor({ left, top: 10 });
    }
  }, [externalCursorIdx]);

  const hasSnow = snowRelevant(payload);
  const effectiveCursorIdx = externalCursorIdx ?? hoverIdx;

  return (
    <div className={styles.panels} ref={containerRef}>
      <MountainBackdrop payload={payload} cursorIdx={effectiveCursorIdx} />
      <div className={styles.panel}>
        <div className={styles.panelLabel}><Thermometer size={12} /> Temperature</div>
        <div ref={refs.temp} />
      </div>
      <div className={`${styles.panel} ${styles.panelPadTop}`}>
        <div className={styles.panelLabel}><CloudRain size={12} /> Precipitation <span className={styles.panelAux}>mm/h</span></div>
        <div ref={refs.precip} />
      </div>
      {hasSnow && (
        <div className={styles.panel}>
          <div className={styles.panelLabel}><Snowflake size={12} /> Snow <span className={styles.panelAux}>mm/h &middot; snow line m</span></div>
          <div ref={refs.snow} />
        </div>
      )}
      <div className={`${styles.panel} ${styles.panelPadTop}`}>
        <div className={styles.panelLabel}><Wind size={12} /> Wind <span className={styles.panelAux}>m/s &middot; direction</span></div>
        <div ref={refs.wind} />
      </div>
    </div>
  );
}
