import { useEffect, useRef } from "react";
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
          show: p.series.feelsLike?.some((v) => v != null) ?? false },
        { label: "Cloud", scale: "c", show: false },
      ],
      axes: [axisX(false), axisY({ scale: "t", values: (_u, v) => v.map((x) => `${Math.round(x as number)}°`), size: 40 })],
      hooks: { draw: [nightBandsHook(sun, showNight), cloudBandHook(showCloud, 3), cursorLineHook(),
        (u: uPlot) => { u.setSeries(2, { show: showFeelsLike() }, false); }] },
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
    data: [p.series.time, p.series.ff, p.series.fx] as uPlot.AlignedData,
    opts: {
      cursor: { sync: { key: SYNC_KEY }, drag: { x: false, y: false }, points: { show: false } },
      scales: { x: { time: true }, w: { auto: true } },
      legend: { show: false },
      series: [
        {},
        { label: "Wind", scale: "w", stroke: cWind, width: 2, points: { show: false } },
        { label: "Gust", scale: "w", stroke: cGust, width: 1.5, dash: [4, 4], points: { show: false } },
      ],
      axes: [axisX(true), axisY({ scale: "w", values: (_u, v) => v.map((x) => `${(x as number).toFixed(0)}`), size: 40, space: 30 })],
      hooks: { draw: [nightBandsHook(sun, showNight), cursorLineHook()] },
    },
  };
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
      for (const pl of charts) {
        const rect = pl.over.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const idx = pl.cursor.idx;
          if (idx != null) {
            onCursorRef.current({ idx, clientX: e.clientX, clientY: e.clientY, source: "chart" });
          }
          return;
        }
      }
      onCursorRef.current(null);
    };
    const onLeave = () => onCursorRef.current(null);
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

  return (
    <div className={styles.panels} ref={containerRef}>
      <div className={styles.panel}>
        <div className={styles.panelLabel}><Thermometer size={12} /> Temperature</div>
        <div ref={refs.temp} />
      </div>
      <div className={styles.panel}>
        <div className={styles.panelLabel}><CloudRain size={12} /> Precipitation <span className={styles.panelAux}>mm/h</span></div>
        <div ref={refs.precip} />
      </div>
      {hasSnow && (
        <div className={styles.panel}>
          <div className={styles.panelLabel}><Snowflake size={12} /> Snow <span className={styles.panelAux}>mm/h &middot; snow line m</span></div>
          <div ref={refs.snow} />
        </div>
      )}
      <div className={styles.panel}>
        <div className={styles.panelLabel}><Wind size={12} /> Wind <span className={styles.panelAux}>m/s</span></div>
        <div ref={refs.wind} />
      </div>
    </div>
  );
}
