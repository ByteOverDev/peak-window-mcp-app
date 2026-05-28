import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createContext, StrictMode, use, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Clock, Cloud, MapPin, Moon, Thermometer } from "lucide-react";
import styles from "./mcp-app.module.css";
import vk from "./ventusky.module.css";
import type { CursorState, PeakWindowResult } from "./types.ts";
import { computeSunMarkers } from "./sun.ts";
import { TopBar } from "./components/TopBar.tsx";
import { HeroWindow } from "./components/HeroWindow.tsx";
import { ChartPanels, snowRelevant, type VentuskyPayload } from "./ventusky.tsx";
import { StatsRow } from "./components/StatsRow.tsx";
import { WeekOverview } from "./components/WeekOverview.tsx";
import { FloatingTooltip } from "./components/FloatingTooltip.tsx";
import { PrintView } from "./components/PrintView.tsx";

function parseResult(r: CallToolResult | null): PeakWindowResult | null {
  if (!r) return null;
  if (r.structuredContent) return r.structuredContent as unknown as PeakWindowResult;
  const jsonPart = r.content?.find(
    (c) => c.type === "text" && c.text.startsWith("{"),
  );
  if (jsonPart && jsonPart.type === "text") {
    try { return JSON.parse(jsonPart.text) as PeakWindowResult; } catch { /* fall through */ }
  }
  return null;
}

interface McpContextValue {
  data: PeakWindowResult | null;
  busy: boolean;
}

const McpContext = createContext<McpContextValue | null>(null);

function McpProvider({ children }: { children: React.ReactNode }) {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [busy, setBusy] = useState(true);
  const data = useMemo(() => parseResult(toolResult), [toolResult]);

  const { isConnected, error } = useApp({
    appInfo: { name: "PeakWindow", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (a) => {
      a.ontoolresult = async (result) => { setToolResult(result); setBusy(false); };
      a.onerror = (e) => { console.error(e); setBusy(false); };
      a.onteardown = async () => ({});
    },
  });

  if (error) return <div className={styles.error}>ERROR: {error.message}</div>;
  if (!isConnected) return <div className={styles.loading}>Connecting…</div>;

  return (
    <McpContext value={{ data, busy }}>
      {children}
    </McpContext>
  );
}

function PeakWindowApp() {
  const { data, busy } = use(McpContext)!;

  const [showNight, setShowNight] = useState(true);
  const [showCloud, setShowCloud] = useState(true);
  const [showFeelsLike, setShowFeelsLike] = useState(true);
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (data) setSelectedIdx(0);
  }, [data]);

  const sunMarkers = useMemo(() => {
    if (!data) return [];
    return computeSunMarkers(data.series.time, data.lat, data.lon);
  }, [data]);

  const handleTapeHover = useCallback((idx: number | null, x?: number, y?: number) => {
    if (idx == null) { setCursor(null); return; }
    setCursor({ idx, clientX: x ?? 0, clientY: y ?? 0, source: "tape" });
  }, []);

  const handleChartCursor = useCallback((c: CursorState | null) => {
    setCursor(c);
  }, []);

  const chartPayload: VentuskyPayload | null = useMemo(() => {
    if (!data) return null;
    return {
      lat: data.lat,
      lon: data.lon,
      issued_at: data.issued_at ?? data.fetchedAt,
      peakName: data.peakName,
      summitElevationM: data.summitElevationM,
      gridElevationM: data.gridElevationM,
      lapseDeltaC: data.lapseDeltaC,
      gridResolutionKm: data.gridResolutionKm,
      series: data.series,
      score: data.hours.map((h) => h.score),
      profile: data.profile,
      backProfile: data.backProfile,
      peakIdx: data.peakIdx,
    };
  }, [data]);

  const showSnow = chartPayload ? snowRelevant(chartPayload) : false;
  const [snowlmtMin, snowlmtMax] = useMemo(() => {
    if (!showSnow || !data) return [null, null];
    const vals = data.series.snowlmt.filter((v): v is number => v != null);
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [null, null];
  }, [data, showSnow]);

  const windows = data?.windows ?? [];
  const selectedWindow = windows[selectedIdx] ?? windows[0];

  return (
    <div className={styles.embed}>
      <TopBar data={data} windowCount={windows.length} />

      {!data && !busy && (
        <div className={styles.empty}>
          Ask Claude to run the <code>peak-window</code> tool for any summit.
        </div>
      )}

      {!data && busy && (
        <div className={styles.skeleton} role="status" aria-label="Loading forecast data">
          <div className={`${styles.skelBlock} ${styles.skelHero}`} />
          <div className={`${styles.skelBlock} ${styles.skelOverview}`} />
          <div className={`${styles.skelBlock} ${styles.skelChart}`} />
        </div>
      )}

      {data && (
        <>
          <HeroWindow
            window={selectedWindow}
            hours={data.hours}
            sunMarkers={sunMarkers}
            totalHours={data.series.time.length}
            selectedIdx={selectedIdx}
            totalWindows={windows.length}
            peakName={data.peakName}
            lat={data.lat}
            lon={data.lon}
            summitElevation={data.summitElevationM}

            onPrev={() => setSelectedIdx(Math.max(0, selectedIdx - 1))}
            onNext={() => setSelectedIdx(Math.min(windows.length - 1, selectedIdx + 1))}
          />

          <WeekOverview
            hours={data.hours}
            windows={windows}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
            cursorIdx={cursor?.idx ?? null}
            onHover={handleTapeHover}
          />

          <div className={styles.forecast}>
            <div className={vk.header}>
              <div className={vk.headerLeft}>
                <h3 className={vk.title}>Forecast detail</h3>
                <div className={vk.meta}>window {selectedIdx + 1} of {windows.length}</div>
                <div className={vk.meta}><MapPin size={11} />{data.lat.toFixed(3)}, {data.lon.toFixed(3)}</div>
                <div className={vk.meta}><Clock size={11} />issued {new Date(data.issued_at ?? data.fetchedAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</div>
              </div>
              <div className={vk.toggles}>
                <button className={vk.toggle} aria-pressed={showFeelsLike} onClick={() => setShowFeelsLike(v => !v)}>
                  <Thermometer size={13} /> Feels-like
                </button>
                <button className={vk.toggle} aria-pressed={showNight} onClick={() => setShowNight(v => !v)}>
                  <Moon size={13} /> Night
                </button>
                <button className={vk.toggle} aria-pressed={showCloud} onClick={() => setShowCloud(v => !v)}>
                  <Cloud size={13} /> Cloud
                </button>
              </div>
            </div>

            <div className={vk.lapseLine}>
              {data.lapseDeltaC != null && (
                <>
                  <span>
                    Lapse-corrected <strong>{data.lapseDeltaC.toFixed(1)}&deg;C</strong>
                    <span className={vk.lapseSep}> from grid </span>
                    <strong>{Math.round(data.gridElevationM!)} m</strong>
                    <span className={vk.lapseSep}> &rarr; summit </span>
                    <strong>{data.summitElevationM} m</strong>
                  </span>
                  <span className={vk.lapseSep}>&middot;</span>
                </>
              )}
              <span>{data.gridResolutionKm} km grid</span>
              {snowlmtMin != null && snowlmtMax != null && (
                <>
                  <span className={vk.lapseSep}>&middot;</span>
                  <span>
                    Snow line <strong>{(snowlmtMin / 1000).toFixed(1)} km</strong> &rarr; <strong>{(snowlmtMax / 1000).toFixed(1)} km</strong>
                  </span>
                </>
              )}
            </div>

            <div className={vk.forecastBody}>
              {chartPayload && (
                <ChartPanels
                  payload={chartPayload}
                  showNight={showNight}
                  showCloud={showCloud}
                  showFeelsLike={showFeelsLike}
                  onCursor={handleChartCursor}
                  externalCursorIdx={cursor?.source === "tape" ? cursor.idx : null}
                />
              )}
            </div>

            <StatsRow data={data} />

            <div className={vk.source}>
              Source: {data.source}
              {data.lapseNote && <> &middot; {data.lapseNote}</>}
              {" "}&middot; fetched {new Date(data.fetchedAt).toLocaleString()}
            </div>
            <div className={vk.disclaimer}>
              Scores are automated estimates based on NWP model output, not a substitute for local knowledge, current conditions, or alpine experience. Always check official forecasts and assess conditions on the ground.
            </div>
          </div>
        </>
      )}

      {data && <FloatingTooltip data={data} cursor={cursor} />}
      {data && <PrintView data={data} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <McpProvider>
      <PeakWindowApp />
    </McpProvider>
  </StrictMode>,
);
