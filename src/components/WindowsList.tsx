import { ratingColor } from "../rating-color.ts";
import type { ClimbWindow } from "../types.ts";
import s from "./WindowsList.module.css";

const wd = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short" });
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtHM = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

interface WindowsListProps {
  windows: ClimbWindow[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}

export function WindowsList({ windows, selectedIdx, onSelect }: WindowsListProps) {
  if (!windows.length) return null;
  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <span className={s.eyebrow}>All windows</span>
        <span className={s.sub}>{windows.length} found &middot; ranked by score &times; duration</span>
      </div>
      <div className={s.grid}>
        {windows.map((w, i) => {
          const a = new Date(w.start);
          const b = new Date(w.end);
          const sameDay = a.toDateString() === b.toDateString();
          const isSel = i === selectedIdx;
          return (
            <button
              key={i}
              className={`${s.card} ${isSel ? s.selected : ""}`}
              onClick={() => onSelect(i)}
            >
              <div className={s.rank}>
                <span className={s.num}>{i + 1}</span>
                <span className={`${s.chip} ${s[w.rating] ?? ""}`}>{w.rating}</span>
              </div>
              <div className={s.time}>
                {fmtHM(a)}<span className={s.arr}> &#8594; </span>{fmtHM(b)}
              </div>
              <div className={s.day}>{sameDay ? `${wd(a)} ${fmtDay(a)}` : `${fmtDay(a)} – ${fmtDay(b)}`}</div>
              <div className={s.sum}>{w.summary}</div>
              <div className={s.foot}>
                <span className={s.dur}>{w.hours}h</span>
                <span className={s.score} style={{ color: ratingColor(w.rating) }}>
                  {Math.round(w.avgScore)}<span className={s.of}>/100</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
