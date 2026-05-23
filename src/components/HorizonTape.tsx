import { useMemo } from "react";
import { ratingColor } from "../rating-color.ts";
import type { ScoredHour, SunMarker } from "../types.ts";
import s from "./HorizonTape.module.css";

const fmtHM = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

interface HorizonTapeProps {
  hours: ScoredHour[];
  times: number[];
  sunMarkers: SunMarker[];
  cursorIdx: number | null;
  onHover: (idx: number | null, x?: number, y?: number) => void;
}

export function HorizonTape({ hours, times, sunMarkers, cursorIdx, onHover }: HorizonTapeProps) {
  const axisMarks = useMemo(() => {
    const marks: Array<{ frac: number; label: string; kind: "day" | "sun" }> = [];
    const total = times.length;
    for (let i = 0; i < total; i++) {
      const d = new Date(times[i] * 1000);
      const prev = i > 0 ? new Date(times[i - 1] * 1000) : null;
      if (i === 0 || (prev && d.getDate() !== prev.getDate())) {
        marks.push({
          frac: i / (total - 1),
          label: d.toLocaleDateString(undefined, { weekday: "short" }) + " " + d.getDate(),
          kind: "day",
        });
      }
    }
    for (const sm of sunMarkers) {
      for (const [sym, t] of [
        ["↑", sm.sunriseEpoch] as const,
        ["↓", sm.sunsetEpoch] as const,
      ]) {
        if (t >= times[0] && t <= times[times.length - 1]) {
          const frac = (t - times[0]) / (times[times.length - 1] - times[0]);
          marks.push({ frac, label: sym + fmtHM(new Date(t * 1000)), kind: "sun" });
        }
      }
    }
    return marks;
  }, [times, sunMarkers]);

  return (
    <div className={s.horizon}>
      <div className={s.head}>
        <div className={s.title}>
          <span className={s.eyebrow}>Horizon</span>
          <span className={s.now}>Next {times.length} h</span>
        </div>
        <div className={s.legend}>
          <span><span className={s.dot} style={{ background: "var(--score-ideal)" }} />ideal</span>
          <span><span className={s.dot} style={{ background: "var(--score-good)" }} />good</span>
          <span><span className={s.dot} style={{ background: "var(--score-marginal)" }} />marginal</span>
          <span><span className={s.dot} style={{ background: "var(--score-avoid)" }} />avoid</span>
        </div>
      </div>

      <div className={s.card}>
        <div className={s.bars} onMouseLeave={() => onHover(null)}>
          {hours.map((h, i) => (
            <div key={i}
              className={`${s.bar} ${i === 0 ? s.isNow : ""}`}
              style={{
                height: `${Math.max(8, h.score)}%`,
                background: ratingColor(h.rating),
                opacity: cursorIdx == null ? 0.85 : (i === cursorIdx ? 1 : 0.45),
              }}
              onMouseEnter={(e) => onHover(i, e.clientX, e.clientY)}
              title={`${fmtHM(new Date(times[i] * 1000))} · score ${h.score}`}
            />
          ))}
        </div>
        <div className={s.axis}>
          {axisMarks.map((m, i) => (
            <span key={i} className={`${s.tick} ${m.kind === "sun" ? s.sun : s.day}`}
              style={{ left: `${m.frac * 100}%` }}>
              {m.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
