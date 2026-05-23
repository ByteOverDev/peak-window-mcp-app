import { Thermometer, Wind } from "lucide-react";
import { useMemo } from "react";
import { ratingColor } from "../rating-color.ts";
import type { ClimbWindow, ScoredHour } from "../types.ts";
import s from "./WeekOverview.module.css";

const fmtHM = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

interface DayGroup {
  date: Date;
  hours: ScoredHour[];
}

interface WeekOverviewProps {
  hours: ScoredHour[];
  windows: ClimbWindow[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}

export function WeekOverview({ hours, windows, selectedIdx, onSelect }: WeekOverviewProps) {
  const days = useMemo(() => {
    const map = new Map<string, DayGroup>();
    hours.forEach((h) => {
      const d = new Date(h.time);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) {
        map.set(key, { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), hours: [] });
      }
      map.get(key)!.hours.push(h);
    });
    return Array.from(map.values());
  }, [hours]);

  const dayBest: Array<{ day: DayGroup; best: ClimbWindow | null; bestIdx: number; tMax: number; tMin: number; wMax: number }> = days.map((day) => {
    const dStart = day.date.getTime();
    const dEnd = dStart + 86400_000;
    let best: ClimbWindow | null = null;
    let bestIdx = -1;
    windows.forEach((w, wi) => {
      const ws = new Date(w.start).getTime();
      const we = new Date(w.end).getTime();
      if (we >= dStart && ws < dEnd) {
        if (!best || w.avgScore > best.avgScore) {
          best = w;
          bestIdx = wi;
        }
      }
    });
    const tMax = Math.max(...day.hours.map(h => h.t2m ?? 0));
    const tMin = Math.min(...day.hours.map(h => h.t2m ?? 0));
    const wMax = Math.max(...day.hours.map(h => h.gust ?? h.wsp ?? 0));
    return { day, best, bestIdx, tMax, tMin, wMax };
  });

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <span className={s.eyebrow}>7-day overview</span>
        <span className={s.sub}>Best window per day &middot; tap to load details</span>
      </div>
      <div className={s.rows}>
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

              <div className={s.bars}>
                {day.hours.map((h, hi) => (
                  <div
                    key={hi}
                    className={s.bar}
                    style={{
                      height: `${Math.max(10, h.score)}%`,
                      background: ratingColor(h.rating),
                    }}
                    title={`${new Date(h.time).getHours()}:00 - ${h.score}/100`}
                  />
                ))}
              </div>

              <div className={s.best}>
                {best ? (
                  <>
                    <div className={s.time}>
                      {fmtHM(new Date(best.start))}<span className={s.arr}> &#8594; </span>{fmtHM(new Date(best.end))}
                    </div>
                    <div className={s.meta}>{best.hours}h &middot; {Math.round(best.avgScore)}/100</div>
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
