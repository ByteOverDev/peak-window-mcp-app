import { Cloud, Compass, Droplets, Mountain, Snowflake, Thermometer, Wind } from "lucide-react";
import { ratingColor } from "../rating-color.ts";
import type { CursorState, PeakWindowResult } from "../types.ts";
import s from "./FloatingTooltip.module.css";

interface FloatingTooltipProps {
  data: PeakWindowResult;
  cursor: CursorState | null;
}

const CARDINALS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"] as const;
function cardinal(deg: number) {
  return CARDINALS[Math.round(((deg % 360 + 360) % 360) / 22.5) % 16];
}

export function FloatingTooltip({ data, cursor }: FloatingTooltipProps) {
  if (!cursor) return null;
  const h = data.hours[cursor.idx];
  if (!h) return null;

  const summit = data.summitElevationM;
  let flag: "snow" | "rain" | "mixed" = "rain";
  if (summit != null && h.snowlmt != null) {
    if (h.snowlmt + 100 < summit) flag = "snow";
    else if (h.snowlmt > summit + 100) flag = "rain";
    else flag = "mixed";
  }

  const left = Math.min(cursor.clientX + 16, window.innerWidth - 260);
  const top = Math.max(cursor.clientY - 100, 10);

  return (
    <div className={s.tooltip} style={{ left, top }}>
      <div className={s.time}>
        <span className={s.when}>
          {new Date(h.time).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
        </span>
        <span className={s.score} style={{ color: ratingColor(h.rating) }}>{h.score}/100</span>
      </div>
      <div className={s.rows}>
        <span className={s.k}><Thermometer size={11} /> Temp</span>
        <span className={s.v} style={{ color: "var(--c-temp)" }}>{h.t2m?.toFixed(1) ?? "—"}&deg;C</span>
        {h.feelsLike != null && (<>
          <span className={s.k}><Thermometer size={11} /> Feels-like</span>
          <span className={s.v} style={{ color: "var(--c-feels)" }}>{h.feelsLike.toFixed(1)}&deg;C</span>
        </>)}
        <span className={s.k}><Wind size={11} /> Wind / gust</span>
        <span className={s.v} style={{ color: "var(--c-wind)" }}>{h.wsp?.toFixed(1) ?? "—"} / {h.gust?.toFixed(1) ?? "—"} m/s</span>
        {h.dd != null && (<>
          <span className={s.k}><Compass size={11} /> Direction</span>
          <span className={s.v} style={{ color: "var(--c-wind)" }}>
            <svg width={11} height={11} viewBox="0 0 16 16" style={{ transform: `rotate(${(h.dd + 180) % 360}deg)`, verticalAlign: "middle", marginRight: 4 }}><path d="M8 2 L12 12 L8 10 L4 12 Z" fill="currentColor"/></svg>
            from {cardinal(h.dd)} &middot; {Math.round(h.dd)}&deg;
          </span>
        </>)}
        <span className={s.k}><Droplets size={11} /> Precip</span>
        <span className={s.v} style={{ color: "var(--c-precip)" }}>
          {h.rr?.toFixed(1) ?? "—"} mm/h
          {h.precipType && h.precipType !== "none" && (
            <span style={{ color: "var(--text-muted)" }}> &middot; {h.precipType}</span>
          )}
        </span>
        <span className={s.k}><Snowflake size={11} /> Snow</span>
        <span className={s.v} style={{ color: "var(--c-snow)" }}>{h.snow?.toFixed(1) ?? "—"} mm/h</span>
        <span className={s.k}><Mountain size={11} /> Snow line &middot; 0&deg;C</span>
        <span className={s.v}>
          {h.snowlmt?.toLocaleString() ?? "—"}
          {h.freezingLevel != null ? ` · ${h.freezingLevel.toLocaleString()}` : ""} m
        </span>
        <span className={s.k}><Cloud size={11} /> Cloud</span>
        <span className={s.v}>{h.tcc != null ? Math.round(h.tcc * 100) : "—"}%</span>
      </div>
      {summit != null && h.snowlmt != null && (
        <div className={s.flagRow}>
          <span>Summit is in</span>
          <span className={`${s.pill} ${s[flag]}`}>{flag}</span>
          {h.tcc != null && h.tcc > 0.8 && Math.abs((h.snowlmt ?? 0) - summit) < 250 && (
            <span className={`${s.pill} ${s.pillCloud}`}>in cloud</span>
          )}
        </div>
      )}
    </div>
  );
}
