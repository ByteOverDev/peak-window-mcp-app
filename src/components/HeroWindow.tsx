import { CloudFog, Droplets, MapPin, Mountain, MoveRight, Snowflake, Thermometer, TrendingDown, TrendingUp, Wind } from "lucide-react";
import { useMemo } from "react";
import { ratingColor } from "../rating-color.ts";
import type { ClimbWindow, ScoredHour, SunMarker } from "../types.ts";
import s from "./HeroWindow.module.css";

const fmtHM = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const wd = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short" });
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

function fmtWindowTitle(w: ClimbWindow): string {
  const a = new Date(w.start);
  const h = a.getHours();
  const slot = h < 6 ? "pre-dawn" : h < 11 ? "morning" : h < 14 ? "midday" : h < 18 ? "afternoon" : h < 21 ? "evening" : "night";
  return `${a.toLocaleDateString(undefined, { weekday: "long" })} ${slot}`;
}

/* ---- helpers ---- */

const COMPASS_16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"] as const;

function toCardinal(deg: number): string {
  const idx = Math.round(((deg % 360 + 360) % 360) / 22.5) % 16;
  return COMPASS_16[idx];
}

/** Vector-mean of wind directions (degrees). */
function dominantDirection(dirs: number[]): number {
  if (!dirs.length) return 0;
  let sx = 0, sy = 0;
  for (const d of dirs) {
    const rad = (d * Math.PI) / 180;
    sx += Math.sin(rad);
    sy += Math.cos(rad);
  }
  const mean = (Math.atan2(sx, sy) * 180) / Math.PI;
  return (mean + 360) % 360;
}

/** "up" | "down" | "flat" based on first-third vs last-third means. */
function trendOf(values: number[]): "up" | "down" | "flat" {
  if (values.length < 3) return "flat";
  const third = Math.max(1, Math.floor(values.length / 3));
  const first = values.slice(0, third);
  const last = values.slice(-third);
  const meanFirst = first.reduce((a, b) => a + b, 0) / first.length;
  const meanLast = last.reduce((a, b) => a + b, 0) / last.length;
  const delta = meanLast - meanFirst;
  const scale = Math.max(Math.abs(meanFirst), Math.abs(meanLast), 1);
  if (Math.abs(delta) / scale < 0.06) return "flat";
  return delta > 0 ? "up" : "down";
}

function TrendIcon({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp size={11} />;
  if (trend === "down") return <TrendingDown size={11} />;
  return <MoveRight size={11} />;
}

function WindGlyph({ deg }: { deg: number }) {
  const rot = (deg + 180) % 360;
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" style={{ transform: `rotate(${rot}deg)`, display: "inline-block", verticalAlign: "middle" }}>
      <path d="M8 2 L12 12 L8 10 L4 12 Z" fill="var(--c-wind)" />
    </svg>
  );
}

/* ---- sub-components ---- */

function ScoreDonut({ score, rating }: { score: number; rating: string }) {
  const r = 50;
  const C = 2 * Math.PI * r;
  const offset = C - (score / 100) * C;
  return (
    <div className={s.orb}>
      <svg viewBox="0 0 120 120" role="img" aria-label={`Weather score: ${score} out of 100, rated ${rating}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={ratingColor(rating)} strokeWidth="9"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(.22,.61,.36,1)" }} />
      </svg>
      <div className={s.orbText}>
        <div className={s.orbNum}>{score}</div>
        <div className={s.orbOf}>/ 100</div>
        <div className={s.orbRating} style={{ color: ratingColor(rating) }}>{rating}</div>
      </div>
    </div>
  );
}

function SunArc({ window: w, sunMarkers }: { window: ClimbWindow; sunMarkers: SunMarker[] }) {
  const day = new Date(w.start);
  const dayStartLocal = new Date(day);
  dayStartLocal.setHours(0, 0, 0, 0);
  const dayStartEpoch = Math.floor(dayStartLocal.getTime() / 1000);
  const targetDayStart = Math.floor(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) / 1000);
  const sm = sunMarkers.find((m) => m.dayStart === targetDayStart)
    || sunMarkers.reduce((best, m) => Math.abs(m.dayStart - targetDayStart) < Math.abs(best.dayStart - targetDayStart) ? m : best, sunMarkers[0]);
  if (!sm) return null;

  const dayDur = 86400;
  const toFrac = (e: number) => Math.max(0, Math.min(1, (e - dayStartEpoch) / dayDur));
  const sunriseFrac = toFrac(sm.sunriseEpoch);
  const sunsetFrac = toFrac(sm.sunsetEpoch);
  const wStartFrac = toFrac(Math.floor(new Date(w.start).getTime() / 1000));
  const wEndFrac = toFrac(Math.floor(new Date(w.end).getTime() / 1000));

  const W = 1000, H = 24;
  const arc = (frac: number) => {
    if (frac < sunriseFrac || frac > sunsetFrac) return null;
    const t = (frac - sunriseFrac) / (sunsetFrac - sunriseFrac);
    return { x: frac * W, y: H - 2 - Math.sin(t * Math.PI) * (H - 4) };
  };

  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 60; i++) {
    const frac = sunriseFrac + (i / 60) * (sunsetFrac - sunriseFrac);
    const p = arc(frac);
    if (p) pts.push(p);
  }

  const winLeft = wStartFrac * 100;
  const winWidth = Math.max(2, (wEndFrac - wStartFrac) * 100);
  const midFrac = (wStartFrac + wEndFrac) / 2;
  const dot = arc(midFrac);

  const curvePts = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <div className={s.sunArc}>
      <div className={s.sunArcBar} style={{ "--sunrise": `${sunriseFrac * 100}%`, "--sunset": `${sunsetFrac * 100}%` } as React.CSSProperties}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Sun arc: sunrise ${fmtHM(new Date(sm.sunriseEpoch * 1000))}, sunset ${fmtHM(new Date(sm.sunsetEpoch * 1000))}, climb window ${fmtHM(new Date(w.start))} to ${fmtHM(new Date(w.end))}`}>
          <rect x={winLeft * 10} y={0} width={winWidth * 10} height={H} fill="var(--gold-soft)" />
          <polyline points={curvePts} fill="none" stroke="var(--gold)" strokeWidth="1.2"
            strokeLinecap="round" strokeDasharray="2,3" opacity="0.7" />
          {dot && <circle cx={dot.x} cy={dot.y} r="3.5" fill="var(--gold)" stroke="var(--surface)" strokeWidth="1.2" />}
        </svg>
      </div>
      <div className={s.sunArcLabels}>
        <span>00:00</span>
        <span>&#8593; {fmtHM(new Date(sm.sunriseEpoch * 1000))}</span>
        <span style={{ color: "var(--gold)" }}>climb &middot; {fmtHM(new Date(w.start))} &#8594; {fmtHM(new Date(w.end))}</span>
        <span>&#8595; {fmtHM(new Date(sm.sunsetEpoch * 1000))}</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

/* ---- alert chips ---- */

function AlertChips({ slice, cAvg, slMin, slMax, summit }: {
  slice: ScoredHour[];
  cAvg: number;
  slMin: number;
  slMax: number;
  summit: number | null;
}) {
  const chips: { key: string; icon: React.ReactNode; text: string; variant: "warn" | "info" }[] = [];

  // In-cloud warning
  if (summit != null && cAvg > 0.75 && slMin < summit + 300 && slMax > summit - 300) {
    chips.push({ key: "incloud", icon: <CloudFog size={13} />, text: "Likely in cloud at summit", variant: "warn" });
  }

  // Precip type summary
  const precipCounts: Record<string, number> = {};
  for (const h of slice) {
    if (h.precipType && h.precipType !== "none") {
      precipCounts[h.precipType] = (precipCounts[h.precipType] || 0) + 1;
    }
  }
  const precipParts = Object.entries(precipCounts).map(([type, count]) => `${count}h ${type}`);
  if (precipParts.length) {
    chips.push({ key: "precip", icon: <Droplets size={13} />, text: precipParts.join(" · "), variant: "info" });
  }

  if (!chips.length) return null;

  return (
    <div className={s.heroAlerts}>
      {chips.map(c => (
        <div key={c.key} className={`${s.alertChip} ${c.variant === "warn" ? s.alertChipWarn : s.alertChipInfo}`}>
          {c.icon}
          <span>{c.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ---- snow line aux label ---- */

function snowLineAux(slMin: number, slMax: number, summit: number | null): { text: string; className: string } | null {
  if (summit == null) return null;
  if (slMax < summit - 100) return { text: "summit in snow", className: s.hsAuxFlagSnow };
  if (slMin > summit + 100) return { text: "above snow line", className: s.hsAuxFlagRain };
  return { text: "near snow line", className: s.hsAuxFlagMixed };
}

/* ---- main component ---- */

interface HeroWindowProps {
  window: ClimbWindow | undefined;
  hours: ScoredHour[];
  sunMarkers: SunMarker[];
  totalHours: number;
  selectedIdx: number;
  totalWindows: number;
  peakName?: string | null;
  lat?: number;
  lon?: number;
  summitElevation?: number | null;
  onPrev: () => void;
  onNext: () => void;
}

export function HeroWindow({ window: w, hours, sunMarkers, totalHours, selectedIdx, totalWindows, peakName, lat, lon, summitElevation, onPrev, onNext }: HeroWindowProps) {
  const slice = useMemo(() => {
    if (!w) return [];
    const startIdx = hours.findIndex(h => h.time === w.start);
    const endIdx = hours.findIndex(h => h.time === w.end);
    return hours.slice(startIdx, endIdx + 1);
  }, [hours, w?.start, w?.end]);

  if (!w) {
    return (
      <div className={`${s.card} ${s.hero}`}>
        <div className={s.eyebrow}><span className={s.pulse}>No clear window</span></div>
        <div className={s.heroTime}>Conditions hold below threshold</div>
        <div className={s.heroSub}>No window scored above 60 in the next {totalHours} hours.</div>
      </div>
    );
  }

  const a = new Date(w.start);
  const b = new Date(w.end);
  const sameDay = a.toDateString() === b.toDateString();
  const summit = summitElevation ?? null;

  const tMin = Math.min(...slice.map(h => h.t2m ?? 0));
  const tMax = Math.max(...slice.map(h => h.t2m ?? 0));
  const wMax = Math.max(...slice.map(h => h.gust ?? h.wsp ?? 0));
  const cAvg = slice.reduce((acc, h) => acc + (h.tcc ?? 0), 0) / slice.length;

  // Feels-like min/max
  const flVals = slice.map(h => h.feelsLike).filter((v): v is number => v != null);
  const flMin = flVals.length ? Math.min(...flVals) : null;
  const flMax = flVals.length ? Math.max(...flVals) : null;

  // Snow line — only relevant when it's near the summit
  const slVals = slice.map(h => h.snowlmt).filter((v): v is number => v != null);
  const slMin = slVals.length ? Math.min(...slVals) : 0;
  const slMax = slVals.length ? Math.max(...slVals) : 0;
  const snowRelevant = !summit || !slVals.length || slMin < summit + 500;

  // Wind direction
  const ddVals = slice.map(h => h.dd).filter((v): v is number => v != null);
  const domDir = dominantDirection(ddVals);
  const cardinal = toCardinal(domDir);

  // Trends
  const tempTrend = trendOf(slice.map(h => h.t2m ?? 0));
  const flTrend = trendOf(flVals);
  const windTrend = trendOf(slice.map(h => h.gust ?? h.wsp ?? 0));
  const slTrend = trendOf(slVals);

  // Snow line aux
  const slAux = snowLineAux(slMin, slMax, summit);

  return (
    <div className={`${s.card} ${s.hero}`}>
      <div className={s.eyebrow}>
        <span className={s.pulse}>
          {selectedIdx === 0 ? "Top climb window" : `Climb window ${selectedIdx + 1} of ${totalWindows}`}
        </span>
        <div className={s.peakInfo}>
          {peakName && <span className={s.peakName}><Mountain size={12} />{peakName}</span>}
          {summitElevation != null && <span className={s.peakMeta}>{summitElevation.toLocaleString()} m</span>}
          {lat != null && lon != null && <span className={s.peakMeta}><MapPin size={10} />{lat.toFixed(3)}&deg;N, {lon.toFixed(3)}&deg;E</span>}
        </div>
      </div>
      <div>
        <div className={s.heroTime}>
          {sameDay
            ? <>{fmtHM(a)}<span className={s.arrow}> &#8594; </span>{fmtHM(b)}</>
            : <>{wd(a)} {fmtHM(a)}<span className={s.arrow}> &#8594; </span>{wd(b)} {fmtHM(b)}</>
          }
        </div>
        <div className={s.heroSub}>
          <span className={s.heroSlot}>{fmtWindowTitle(w)}</span>
          {" — "}
          {w.summary.replace(/^\d+h window — /, "")}.
        </div>
      </div>

      <SunArc window={w} sunMarkers={sunMarkers} />

      <AlertChips slice={slice} cAvg={cAvg} slMin={slMin} slMax={slMax} summit={summit} />

      <div className={s.heroBottom}>
        <div className={s.heroStats}>
          <div className={s.stat}>
            <div className={s.statLabel}><Thermometer size={11} /> Temp</div>
            <div className={s.statValue} style={{ color: "var(--c-temp)" }}>
              {Math.round(tMin)}&deg;<span className={s.statUnit}> &#8594; </span>{Math.round(tMax)}&deg;
              {" "}<TrendIcon trend={tempTrend} />
            </div>
          </div>
          <div className={s.stat}>
            <div className={s.statLabel}>
              <Thermometer size={11} /> Feels-like <span className={s.hsPill}>wind chill</span>
            </div>
            <div className={s.statValue} style={{ color: "var(--c-feels)" }}>
              {flMin != null && flMax != null ? (
                <>
                  {Math.round(flMin)}&deg;<span className={s.statUnit}> &#8594; </span>{Math.round(flMax)}&deg;
                  {" "}<TrendIcon trend={flTrend} />
                </>
              ) : (
                <span className={s.statUnit}>n/a</span>
              )}
            </div>
          </div>
          <div className={s.stat}>
            <div className={s.statLabel}><Wind size={11} /> Wind</div>
            <div className={s.statValue} style={{ color: "var(--c-wind)" }}>
              &le;{wMax.toFixed(1)}<span className={s.statUnit}> m/s</span>
              {" "}<TrendIcon trend={windTrend} />
            </div>
            {ddVals.length > 0 && (
              <div className={s.hsAux}>
                <WindGlyph deg={domDir} /> from {cardinal} &middot; {Math.round(domDir)}&deg;
              </div>
            )}
          </div>
          {snowRelevant && (
          <div className={s.stat}>
            <div className={s.statLabel}><Snowflake size={11} /> Snow line</div>
            <div className={s.statValue} style={{ color: "var(--ice)" }}>
              {(slMin / 1000).toFixed(1)}<span className={s.statUnit}>&ndash;{(slMax / 1000).toFixed(1)} km</span>
              {" "}<TrendIcon trend={slTrend} />
            </div>
            {slAux && (
              <div className={s.hsAux}>
                <span className={`${s.hsAuxFlag} ${slAux.className}`}>{slAux.text}</span>
              </div>
            )}
          </div>
          )}
        </div>
        <ScoreDonut score={Math.round(w.avgScore)} rating={w.rating} />
      </div>

      {totalWindows > 1 && (
        <div className={s.nav}>
          <button className={s.navBtn} onClick={onPrev} disabled={selectedIdx === 0} aria-label="Previous window">&#8249;</button>
          <span className={s.navLabel}>
            {w.hours}h &middot; {sameDay ? `${wd(a)} ${fmtDay(a)}` : `${fmtDay(a)} – ${fmtDay(b)}`}
          </span>
          <button className={s.navBtn} onClick={onNext} disabled={selectedIdx >= totalWindows - 1} aria-label="Next window">&#8250;</button>
        </div>
      )}
    </div>
  );
}
