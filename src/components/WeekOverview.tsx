import { Thermometer, Wind } from "lucide-react";
import { useMemo } from "react";
import { ratingColor } from "../rating-color.ts";
import type { ClimbWindow, ScoredHour } from "../types.ts";
import s from "./WeekOverview.module.css";

const fmtHM = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

interface DayGroup {
  date: Date;
  hours: Array<{ hour: ScoredHour; flatIdx: number }>;
}

interface WeekOverviewProps {
  hours: ScoredHour[];
  windows: ClimbWindow[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  cursorIdx: number | null;
  onHover: (idx: number | null, x?: number, y?: number) => void;
}

export function WeekOverview({ hours, windows, selectedIdx, onSelect, cursorIdx, onHover }: WeekOverviewProps) {
  const days = useMemo(() => {
    const map = new Map<string, DayGroup>();
    hours.forEach((h, i) => {
      const d = new Date(h.time);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) {
        map.set(key, { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), hours: [] });
      }
      map.get(key)!.hours.push({ hour: h, flatIdx: i });
    });
    return Array.from(map.values());
  }, [hours]);

  const windowHourSet = useMemo(() => {
    const set = new Set<number>();
    hours.forEach((h, i) => {
      const t = new Date(h.time).getTime();
      for (const w of windows) {
        if (t >= new Date(w.start).getTime() && t < new Date(w.end).getTime()) {
          set.add(i);
          break;
        }
      }
    });
    return set;
  }, [hours, windows]);

  const dayBest: Array<{ day: DayGroup; best: ClimbWindow | null; bestIdx: number; tMax: number; tMin: number; wMax: number }> = days.map((day) => {
    const dStart = day.date.getTime();
    const dEnd = dStart + 86400_000;
    let best: ClimbWindow | null = null;
    let bestIdx = -1;
    windows.forEach((w, wi) => {
      const ws = new Date(w.start).getTime();
      const we = new Date(w.end).getTime();
      if (we >= dStart && ws < dEnd) {
        if (!best || w.score > best.score) {
          best = w;
          bestIdx = wi;
        }
      }
    });
    const tMax = Math.max(...day.hours.map(({ hour: h }) => h.t2m ?? 0));
    const tMin = Math.min(...day.hours.map(({ hour: h }) => h.t2m ?? 0));
    const wMax = Math.max(...day.hours.map(({ hour: h }) => h.gust ?? h.wsp ?? 0));
    return { day, best, bestIdx, tMax, tMin, wMax };
  });

  return (
    <div className={s.wrap}>
      <div className={s.rows}>
        <div className={s.head}>
          <div className={s.headLeft}>
            <h3 className={s.title}>{days.length}-day overview</h3>
            <span className={s.meta}>best window per day</span>
            <span className={s.meta}>hover bars to scrub</span>
          </div>
          <div className={s.legend}>
            <span><span className={s.dot} style={{ background: "var(--score-ideal)" }} />ideal</span>
            <span><span className={s.dot} style={{ background: "var(--score-good)" }} />good</span>
            <span><span className={s.dot} style={{ background: "var(--score-fair)" }} />fair</span>
            <span><span className={s.dot} style={{ background: "var(--score-marginal)" }} />marginal</span>
            <span><span className={s.dot} style={{ background: "var(--score-avoid)" }} />avoid</span>
          </div>
        </div>
        {dayBest.map(({ day, best, bestIdx, tMin, tMax, wMax }, i) => {
          const isToday = i === 0;
          const isSel = bestIdx >= 0 && bestIdx === selectedIdx;
          const wdStr = day.date.toLocaleDateString(undefined, { weekday: "short" });
          const md = day.date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          return (
            <button
              key={i}
              className={`${s.row} ${isSel ? s.selected : ""} ${best ? s.hasWindow : s.noWindow}`}
              onClick={() => bestIdx >= 0 && onSelect(bestIdx)}
              disabled={bestIdx < 0}
            >
              <div className={s.date}>
                <div className={s.wd}>{wdStr}{isToday && <span className={s.today}>today</span>}</div>
                <div className={s.md}>{md}</div>
              </div>

              <div className={s.bars} role="img" aria-label={`Hourly scores for ${wdStr}: ${day.hours.length} hours, best ${Math.max(...day.hours.map(({hour: hh}) => hh.score))}/100`} onMouseLeave={() => onHover(null)}>
                {day.hours.map(({ hour: h, flatIdx }) => (
                  <div
                    key={flatIdx}
                    className={`${s.bar} ${windowHourSet.has(flatIdx) ? s.inWindow : ""}`}
                    style={{
                      height: `${Math.max(10, h.score)}%`,
                      background: ratingColor(h.rating),
                      opacity: cursorIdx == null ? 0.85 : (flatIdx === cursorIdx ? 1 : 0.45),
                    }}
                    onMouseEnter={(e) => onHover(flatIdx, e.clientX, e.clientY)}
                    title={`${new Date(h.time).getHours()}:00 - ${h.score}/100 (${h.rating})`}
                  />
                ))}
              </div>

              <div className={s.best}>
                {best ? (
                  <>
                    <div className={s.time}>
                      {fmtHM(new Date(best.start))}<span className={s.arr}> &#8594; </span>{fmtHM(new Date(best.end))}
                    </div>
                    <div className={s.meta}>{best.hours}h &middot; {Math.round(best.score)}/100</div>
                  </>
                ) : (
                  <div className={s.empty}>&mdash; no climb window</div>
                )}
              </div>

              <div className={s.stats}>
                <span><Thermometer size={10} />{Math.round(tMin)}&deg;/{Math.round(tMax)}&deg;</span>
                <span><Wind size={10} />&le;{wMax.toFixed(0)}</span>
              </div>

              {best && (
                <span className={`${s.chip} ${s[best.rating] ?? ""}`}>{best.rating}</span>
              )}
              {!best && <span className={`${s.chip} ${s.avoid}`} style={{ opacity: 0.5 }}>avoid</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
