import { useMemo } from "react";
import type { PeakWindowResult } from "../types.ts";
import s from "./MountainProfile.module.css";

const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass = (deg: number) => COMPASS[Math.round(((deg % 360 + 360) % 360) / 22.5) % 16];

interface MountainProfileProps {
  data: PeakWindowResult;
  cursorIdx: number | null;
}

export function MountainProfile({ data, cursorIdx }: MountainProfileProps) {
  const summit = data.summitElevationM;
  const grid = data.gridElevationM;
  if (summit == null || grid == null) return null;

  const snowSeries = data.series.snowlmt;
  const idx = cursorIdx ?? 0;
  const snowLine = snowSeries[idx] ?? snowSeries[0] ?? 2500;
  const summitInSnow = snowLine < summit;

  const fzLine = data.series.freezingLevel?.[idx] ?? data.series.freezingLevel?.[0] ?? null;
  const hour = data.hours[idx];
  const dd = hour?.dd ?? null;
  const feelsLike = hour?.feelsLike ?? null;
  const t2m = hour?.t2m ?? null;
  const ff = hour?.wsp ?? null;
  const precipType = hour?.precipType ?? "none";

  const snowLineVisible = snowLine <= summit + 500;
  const relevantSnow = snowLineVisible ? Math.max(...snowSeries.filter((v): v is number => v != null && v <= summit + 500)) + 400 : 0;
  const yMax = Math.max(summit + 800, relevantSnow);
  const yMin = 0;
  const W = 280, H = 224;
  const PAD_X = 12, PAD_TOP = 26, PAD_BOTTOM = 22;
  const yTo = (m: number) => H - PAD_BOTTOM - ((m - yMin) / (yMax - yMin)) * (H - PAD_TOP - PAD_BOTTOM);

  const ridgePts = useMemo(() => {
    const pts: [number, number][] = [];
    const peakX = W * 0.55;
    const yPeak = yTo(summit);
    const yBase = H - PAD_BOTTOM;
    const leftN = 18;
    for (let i = 0; i <= leftN; i++) {
      const t = i / leftN;
      const x = PAD_X + (peakX - PAD_X) * t;
      const baseY = yBase + (yPeak - yBase) * Math.pow(t, 1.55);
      const jag = Math.sin(i * 1.7) * 1.6 + Math.cos(i * 0.9) * 1.0;
      pts.push([x, baseY + jag * (1 - t * 0.5)]);
    }
    const rightN = 18;
    for (let i = 1; i <= rightN; i++) {
      const t = i / rightN;
      const x = peakX + (W - PAD_X - peakX) * t;
      const baseY = yPeak + (yBase - yPeak) * Math.pow(t, 1.35);
      const jag = Math.sin(i * 1.3) * 1.6 + Math.cos(i * 1.8) * 1.0;
      pts.push([x, baseY + jag * (1 - t * 0.5)]);
    }
    return pts;
  }, [summit, yMax]);

  const ridgePath = `M ${PAD_X},${H - PAD_BOTTOM} ${ridgePts.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} L ${W - PAD_X},${H - PAD_BOTTOM} Z`;
  const snowY = yTo(snowLine);
  const gridY = yTo(grid);
  const peakNameStr = data.peakName ?? "Summit";
  const sx = W * 0.55;
  const sy = yTo(summit);

  return (
    <div className={s.rail}>
      <div className={s.title}>Elevation profile</div>
      <div className={s.svgWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Elevation profile: ${peakNameStr} at ${summit.toLocaleString()}m, snow line at ${snowLine.toLocaleString()}m, grid at ${grid.toLocaleString()}m`}>
          <defs>
            <linearGradient id="pw-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--gold-soft)" stopOpacity="0.5" />
              <stop offset="60%" stopColor="var(--surface-2)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <linearGradient id="pw-rock" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--surface-3)" />
              <stop offset="100%" stopColor="var(--surface-2)" />
            </linearGradient>
            <linearGradient id="pw-snow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--c-snowlmt)" stopOpacity="0.95" />
              <stop offset="100%" stopColor="var(--c-snow)" stopOpacity="0.65" />
            </linearGradient>
            <clipPath id="pw-ridgeClip"><path d={ridgePath} /></clipPath>
          </defs>

          <rect x="0" y="0" width={W} height={H} fill="url(#pw-sky)" />
          <path d={ridgePath} fill="url(#pw-rock)" stroke="var(--border-strong)" strokeWidth="0.6" />

          {snowLineVisible && (<>
            <g clipPath="url(#pw-ridgeClip)">
              <rect x="0" y={0} width={W} height={Math.max(0, snowY)} fill="url(#pw-snow)" style={{ transition: "height 360ms" }} />
              <line x1="0" y1={snowY + 6} x2={W} y2={snowY + 6} stroke="rgba(255,255,255,0.07)" strokeWidth="0.6" />
              <line x1="0" y1={snowY + 14} x2={W} y2={snowY + 14} stroke="rgba(255,255,255,0.05)" strokeWidth="0.6" />
            </g>

            <line x1="0" y1={snowY} x2={W} y2={snowY}
              stroke="var(--c-snowlmt)" strokeWidth="1" strokeDasharray="3,3" opacity="0.85"
              style={{ transition: "y1 360ms, y2 360ms" }} />
            <rect x={W - 70} y={snowY - 14} width="64" height="14" rx="3"
              fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="0.5"
              style={{ transition: "y 360ms" }} />
            <text x={W - 38} y={snowY - 4} textAnchor="middle"
              fontSize="9" fontWeight="600" letterSpacing="0.06em"
              fill="var(--c-snowlmt)" style={{ transition: "y 360ms" }}>
              SNOW {snowLine.toLocaleString()}m
            </text>
          </>)}

          {/* Freezing level line */}
          {fzLine != null && fzLine > 0 && fzLine < yMax && (() => {
            const fzY = yTo(fzLine);
            return (
              <>
                <line x1="0" y1={fzY} x2={W} y2={fzY}
                  stroke="var(--c-feels)" strokeWidth="1" strokeDasharray="1.5,3" opacity="0.85"
                  style={{ transition: "y1 360ms, y2 360ms" }} />
                <rect x={2} y={fzY - 14} width={58} height="14" rx="3"
                  fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="0.5"
                  style={{ transition: "y 360ms" }} />
                <text x={6} y={fzY - 4} fontSize="9" fontWeight="600" letterSpacing="0.06em"
                  fill="var(--c-feels)" style={{ transition: "y 360ms" }}>
                  0°C {fzLine.toLocaleString()}m
                </text>
              </>
            );
          })()}

          <line x1="0" y1={gridY} x2={W} y2={gridY}
            stroke="var(--text-faint)" strokeWidth="0.6" strokeDasharray="2,3" opacity="0.6" />
          <rect x={2} y={gridY - 11} width={62} height="12" rx="2"
            fill="var(--surface)" opacity="0.92" stroke="var(--border)" strokeWidth="0.5" />
          <text x={6} y={gridY - 2} fontSize="8.5" fill="var(--text-muted)" letterSpacing="0.06em" fontWeight="600">
            GRID {grid.toLocaleString()}m
          </text>

          <g>
            <line x1={sx} y1={sy} x2={sx} y2={sy - 14}
              stroke={summitInSnow ? "var(--c-snowlmt)" : "var(--gold)"} strokeWidth="1" />
            <circle cx={sx} cy={sy - 14} r="3"
              fill={summitInSnow ? "var(--c-snowlmt)" : "var(--gold)"} stroke="var(--surface)" strokeWidth="1" />
            <text x={sx} y={sy - 22} textAnchor="middle"
              fontSize="9" fontWeight="600" letterSpacing="0.08em" fill="var(--text)">
              {peakNameStr.toUpperCase()}
            </text>
            <text x={sx} y={sy + 12} textAnchor="middle" fontSize="9" fill="var(--text-muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}>
              {summit.toLocaleString()} m
            </text>

            {/* Wind direction arrow above summit */}
            {dd != null && (() => {
              const arrowY = sy - 36;
              const arrowRot = (dd + 180) % 360;
              return (
                <>
                  <g transform={`translate(${sx}, ${arrowY}) rotate(${arrowRot})`}
                    style={{ transition: "transform 240ms" }}>
                    <path d="M 0,-7 L 5,7 L 0,4 L -5,7 Z" fill="var(--c-wind)" opacity="0.95" />
                  </g>
                  <text x={sx + 12} y={arrowY + 3} fontSize="8.5" fill="var(--text-muted)"
                    style={{ transition: "y 240ms" }}>
                    {compass(dd)}
                  </text>
                </>
              );
            })()}
          </g>
        </svg>
      </div>

      <div className={s.legend}>
        <div className={s.legRow}><span className={s.swatch} style={{ background: "var(--gold)" }} /> Summit &middot; {summit.toLocaleString()} m</div>
        {snowLineVisible && (
          <div className={s.legRow}><span className={s.swatch} style={{ background: "var(--c-snowlmt)" }} /> Snow line &middot; {snowLine.toLocaleString()} m</div>
        )}
        <div className={s.legRow}><span className={s.swatch} style={{ background: "var(--text-faint)" }} /> Grid centroid &middot; {grid.toLocaleString()} m</div>
        {fzLine != null && (
          <div className={s.legRow}><span className={s.swatch} style={{ background: "var(--c-feels)" }} /> 0°C isotherm &middot; {fzLine.toLocaleString()} m</div>
        )}
      </div>

      <div className={s.cursor}>
        <div className={s.cursorWhen}>
          {cursorIdx == null
            ? "Hover the forecast to scrub time"
            : new Date(data.series.time[idx] * 1000).toLocaleString([], {
                weekday: "short", month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit", hour12: false,
              })}
        </div>
        {snowLineVisible && precipType !== "none" && (
          <div className={s.cursorRow}>
            <span>Precip at summit</span>
            <span className={`${s.flag} ${summitInSnow ? s.flagSnow : (Math.abs(snowLine - summit) < 200 ? s.flagMixed : s.flagRain)}`}>
              {summitInSnow ? "snow" : (Math.abs(snowLine - summit) < 200 ? "mixed" : "rain")}
            </span>
          </div>
        )}
        {feelsLike != null && (
          <div className={s.cursorRow}>
            <span>Feels-like</span>
            <span style={{ color: "var(--c-feels)" }}>
              {feelsLike.toFixed(1)}°C
              {t2m != null && Math.abs(feelsLike - t2m) > 0.5 && (
                <span className={s.actual}> ({t2m.toFixed(1)}° actual)</span>
              )}
            </span>
          </div>
        )}
        {dd != null && ff != null && (
          <div className={s.cursorRow}>
            <span>Wind</span>
            <span style={{ color: "var(--c-wind)" }}>
              <span className={s.windGlyph}>↓</span> from {compass(dd)} &middot; {ff.toFixed(1)} m/s
            </span>
          </div>
        )}
        {snowLineVisible && precipType !== "none" && (
          <div className={s.cursorRow}>
            <span>Precip type</span>
            <span className={`${s.pill} ${s[`pill${precipType.charAt(0).toUpperCase()}${precipType.slice(1)}`]}`}>
              {precipType}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
