import type { PeakWindowResult } from "../types.ts";
import type { ScoredHour, ClimbWindow } from "../scoring.ts";
import s from "./PrintView.module.css";

interface PrintViewProps {
  data: PeakWindowResult;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function compass(deg: number | null): string {
  if (deg == null) return "—";
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return COMPASS[idx];
}

function fmtNum(v: number | null | undefined, digits = 0, suffix = ""): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtHourShort(iso: string): string {
  return new Date(iso).toLocaleString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDayLabel(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric" });
}

interface WindowMetrics {
  maxGust: number | null;
  totalPrecip: number;
  minFeels: number | null;
  minT: number | null;
  maxT: number | null;
  snowMin: number | null;
  snowMax: number | null;
}

function windowMetrics(window: ClimbWindow, hours: ScoredHour[]): WindowMetrics {
  const start = new Date(window.start).getTime();
  const end = new Date(window.end).getTime();
  const slice = hours.filter((h) => {
    const t = new Date(h.time).getTime();
    return t >= start && t <= end;
  });
  const gusts = slice.map((h) => h.gust).filter((v): v is number => v != null);
  const feels = slice.map((h) => h.feelsLike).filter((v): v is number => v != null);
  const temps = slice.map((h) => h.t2m).filter((v): v is number => v != null);
  const snows = slice.map((h) => h.snowlmt).filter((v): v is number => v != null);
  return {
    maxGust: gusts.length ? Math.max(...gusts) : null,
    totalPrecip: slice.reduce((sum, h) => sum + (h.rr ?? 0), 0),
    minFeels: feels.length ? Math.min(...feels) : null,
    minT: temps.length ? Math.min(...temps) : null,
    maxT: temps.length ? Math.max(...temps) : null,
    snowMin: snows.length ? Math.min(...snows) : null,
    snowMax: snows.length ? Math.max(...snows) : null,
  };
}

function hourInAnyWindow(time: string, windows: ClimbWindow[]): boolean {
  const t = new Date(time).getTime();
  return windows.some((w) => t >= new Date(w.start).getTime() && t <= new Date(w.end).getTime());
}

export function PrintView({ data }: PrintViewProps) {
  const { hours, windows } = data;

  const temps = hours.map((h) => h.t2m).filter((v): v is number => v != null);
  const gusts = hours.map((h) => h.gust).filter((v): v is number => v != null);
  const totalPrecip = hours.reduce((sum, h) => sum + (h.rr ?? 0), 0);
  const totalSnow = hours.reduce((sum, h) => sum + (h.snow ?? 0), 0);

  const best = windows[0];

  return (
    <div className={s.print}>
      <header className={s.header}>
        <h1 className={s.title}>{data.peakName ?? "Forecast"}</h1>
        <div className={s.headerMeta}>
          <div>
            {data.lat.toFixed(3)}, {data.lon.toFixed(3)}
            {data.summitElevationM != null && <> · summit {data.summitElevationM} m</>}
            {data.gridElevationM != null && <> · grid {Math.round(data.gridElevationM)} m</>}
            {data.lapseDeltaC != null && <> · lapse {data.lapseDeltaC.toFixed(1)}°C</>}
          </div>
          <div>
            Issued {fmtDate(data.issued_at ?? data.fetchedAt)} · Source {data.source} · {data.gridResolutionKm} km grid
          </div>
        </div>
      </header>

      {best && (
        <section className={s.section}>
          <h2 className={s.h2}>Best climb window</h2>
          <div className={s.bestBox}>
            <div className={s.bestTop}>
              <div className={s.bestRange}>
                {fmtDate(best.start)} – {fmtHourShort(best.end)}
                <span className={s.bestHours}>({best.hours} h)</span>
              </div>
              <div className={s.bestScore}>
                {best.rating.toUpperCase()} · {Math.round(best.score)}/100
              </div>
            </div>
            <dl className={s.bestStats}>
              {(() => {
                const m = windowMetrics(best, hours);
                return (
                  <>
                    <div><dt>Temp</dt><dd>{fmtNum(m.minT, 0, "°")} to {fmtNum(m.maxT, 0, "°C")}</dd></div>
                    <div><dt>Feels min</dt><dd>{fmtNum(m.minFeels, 0, "°C")}</dd></div>
                    <div><dt>Max gust</dt><dd>{fmtNum(m.maxGust, 0, " m/s")}</dd></div>
                    <div><dt>Total precip</dt><dd>{fmtNum(m.totalPrecip, 1, " mm")}</dd></div>
                    <div><dt>Snow line</dt><dd>{m.snowMin != null && m.snowMax != null ? `${Math.round(m.snowMin)}–${Math.round(m.snowMax)} m` : "—"}</dd></div>
                  </>
                );
              })()}
            </dl>
            {best.reasons.length > 0 && (
              <div className={s.reasons}>Notes: {best.reasons.join("; ")}</div>
            )}
          </div>
        </section>
      )}

      {windows.length > 0 && (
        <section className={s.section}>
          <h2 className={s.h2}>All climb windows</h2>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Day</th>
                <th>Start</th>
                <th>End</th>
                <th className={s.num}>Hrs</th>
                <th className={s.num}>Score</th>
                <th>Rating</th>
                <th className={s.num}>Max gust</th>
                <th className={s.num}>Precip</th>
                <th className={s.num}>Min feels</th>
              </tr>
            </thead>
            <tbody>
              {windows.map((w, i) => {
                const m = windowMetrics(w, hours);
                return (
                  <tr key={i}>
                    <td>{fmtDayLabel(w.start)}</td>
                    <td>{fmtHourShort(w.start)}</td>
                    <td>{fmtHourShort(w.end)}</td>
                    <td className={s.num}>{w.hours}</td>
                    <td className={s.num}>{Math.round(w.score)}</td>
                    <td>{w.rating}</td>
                    <td className={s.num}>{fmtNum(m.maxGust, 0)}</td>
                    <td className={s.num}>{m.totalPrecip.toFixed(1)}</td>
                    <td className={s.num}>{fmtNum(m.minFeels, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className={s.section}>
        <h2 className={s.h2}>Hourly forecast</h2>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th className={s.num}>T °C</th>
              <th className={s.num}>Feels</th>
              <th className={s.num}>Wind</th>
              <th className={s.num}>Gust</th>
              <th>Dir</th>
              <th className={s.num}>Precip</th>
              <th>Type</th>
              <th className={s.num}>Snow line</th>
              <th className={s.num}>Cloud</th>
              <th className={s.num}>Score</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h, i) => {
              const inWin = hourInAnyWindow(h.time, windows);
              const d = new Date(h.time);
              const newDay = i === 0 || d.getHours() === 0;
              return (
                <tr key={h.time} className={`${inWin ? s.rowInWin : ""} ${newDay ? s.rowNewDay : ""}`}>
                  <td>{newDay ? fmtDayLabel(h.time) + " " : ""}{fmtHourShort(h.time)}</td>
                  <td className={s.num}>{fmtNum(h.t2m, 0)}</td>
                  <td className={s.num}>{fmtNum(h.feelsLike, 0)}</td>
                  <td className={s.num}>{fmtNum(h.wsp, 0)}</td>
                  <td className={s.num}>{fmtNum(h.gust, 0)}</td>
                  <td>{compass(h.dd)}</td>
                  <td className={s.num}>{fmtNum(h.rr, 1)}</td>
                  <td>{h.precipType === "none" ? "—" : h.precipType}</td>
                  <td className={s.num}>{h.snowlmt != null ? Math.round(h.snowlmt) : "—"}</td>
                  <td className={s.num}>{h.tcc != null ? Math.round(h.tcc * 100) : "—"}</td>
                  <td className={s.num}>{Math.round(h.score)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>Summary</h2>
        <dl className={s.summary}>
          <div><dt>Temp range</dt><dd>{temps.length ? `${Math.min(...temps).toFixed(0)}° to ${Math.max(...temps).toFixed(0)}°C` : "—"}</dd></div>
          <div><dt>Peak gust</dt><dd>{gusts.length ? `${Math.max(...gusts).toFixed(0)} m/s` : "—"}</dd></div>
          <div><dt>Total precip</dt><dd>{totalPrecip.toFixed(1)} mm</dd></div>
          <div><dt>Total snow</dt><dd>{totalSnow.toFixed(1)} mm</dd></div>
          <div><dt>Forecast horizon</dt><dd>{hours.length} h</dd></div>
        </dl>
      </section>

      <footer className={s.footer}>
        <p>
          Scores are automated estimates based on NWP model output, not a substitute for local
          knowledge, current conditions, or alpine experience. Always check official forecasts
          and assess conditions on the ground.
        </p>
        <p className={s.printed}>
          PeakWindow · Printed {new Date().toLocaleString()} · Data fetched {new Date(data.fetchedAt).toLocaleString()}
        </p>
      </footer>
    </div>
  );
}
