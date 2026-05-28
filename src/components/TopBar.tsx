import { Clock, MountainSnow, Printer } from "lucide-react";
import type { PeakWindowResult } from "../types.ts";
import s from "./TopBar.module.css";

interface TopBarProps {
  data?: PeakWindowResult | null;
  windowCount?: number;
}

export function TopBar({ data, windowCount }: TopBarProps) {
  return (
    <>
    <div className={s.topbar}>
      <div className={s.brand}>
        <div className={s.mark}><MountainSnow size={22} /></div>
        <div>
          <div className={s.name}>PeakWindow</div>
          <div className={s.tag}>Find your moment on the mountain.</div>
        </div>
      </div>
      {data && (
        <div className={s.meta}>
          <div className={s.issued}>
            <Clock size={11} />
            Issued {new Date(data.issued_at ?? data.fetchedAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
          </div>
          <div className={s.windows}>
            <span className={s.wCount}>{windowCount ?? data.windows.length}</span>
            {" "}climb window{(windowCount ?? data.windows.length) === 1 ? "" : "s"} found over {Math.round(data.series.time.length / 24)} days
          </div>
        </div>
      )}
    </div>
    {data && (
      <div className={s.actions}>
        <button
          type="button"
          className={s.printBtn}
          onClick={() => window.print()}
          aria-label="Print forecast"
        >
          <Printer size={14} />
          <span>Print</span>
        </button>
      </div>
    )}
    </>
  );
}
