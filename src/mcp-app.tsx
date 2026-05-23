import type { App } from "@modelcontextprotocol/ext-apps";
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
import { PeakCard, type PeakForm } from "./components/PeakCard.tsx";
import { HorizonTape } from "./components/HorizonTape.tsx";
import { MountainProfile } from "./components/MountainProfile.tsx";
import { ChartPanels, type VentuskyPayload } from "./ventusky.tsx";
import { StatsRow } from "./components/StatsRow.tsx";
import { WeekOverview } from "./components/WeekOverview.tsx";
import { WindowsList } from "./components/WindowsList.tsx";
import { FloatingTooltip } from "./components/FloatingTooltip.tsx";

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
  app: App;
  data: PeakWindowResult | null;
  setToolResult: (r: CallToolResult | null) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}

const McpContext = createContext<McpContextValue | null>(null);

function McpProvider({ children }: { children: React.ReactNode }) {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [busy, setBusy] = useState(false);
  const data = useMemo(() => parseResult(toolResult), [toolResult]);

  const { app, error } = useApp({
    appInfo: { name: "PeakWindow", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (a) => {
      a.ontoolresult = async (result) => { setToolResult(result); };
      a.onerror = console.error;
      a.onteardown = async () => ({});
    },
  });

  if (error) return <div className={styles.error}>ERROR: {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  return (
    <McpContext value={{ app, data, setToolResult, busy, setBusy }}>
      {children}
    </McpContext>
  );
}

function PeakWindowApp() {
  const { app, data, setToolResult, busy, setBusy } = use(McpContext)!;

  const [form, setForm] = useState<PeakForm>({
    peakName: data?.peakName ?? "Großglockner",
    lat: data?.lat?.toString() ?? "47.0741",
    lon: data?.lon?.toString() ?? "12.6939",
    summitElevationM: data?.summitElevationM?.toString() ?? "3798",
  });

  const [showNight, setShowNight] = useState(true);
  const [showCloud, setShowCloud] = useState(true);
  const [showFeelsLike, setShowFeelsLike] = useState(true);
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (data) {
      setForm(prev => ({
        peakName: data.peakName ?? prev.peakName,
        lat: data.lat.toString(),
        lon: data.lon.toString(),
        summitElevationM: data.summitElevationM?.toString() ?? prev.summitElevationM,
      }));
      setSelectedIdx(0);
    }
  }, [data]);

  const handleAnalyze = useCallback(async () => {
    setBusy(true);
    try {
      const summitNum = form.summitElevationM ? parseFloat(form.summitElevationM) : undefined;
      const result = await app.callServerTool({
        name: "peak-window",
        arguments: {
          lat: parseFloat(form.lat),
          lon: parseFloat(form.lon),
          peakName: form.peakName || undefined,
          summitElevationM: Number.isFinite(summitNum as number) ? summitNum : undefined,
        },
      });
      setToolResult(result as CallToolResult);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [app, form, setBusy, setToolResult]);

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
    };
  }, [data]);

  const [snowlmtMin, snowlmtMax] = useMemo(() => {
    const vals = data ? data.series.snowlmt.filter((v): v is number => v != null) : [];
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [null, null];
  }, [data]);

  const windows = data?.windows ?? [];
  const selectedWindow = windows[selectedIdx] ?? windows[0];

  return (
    <div className={styles.embed}>
      <TopBar data={data} windowCount={windows.length} />

      {!data && !busy && (
        <div className={styles.empty}>
          Pick a peak and tap <strong>Analyze</strong>, or ask Claude to run the <code>peak-window</code> tool.
        </div>
      )}

      {data && (
        <>
          <div className={styles.hero}>
            <HeroWindow
              window={selectedWindow}
              hours={data.hours}
              sunMarkers={sunMarkers}
              totalHours={data.series.time.length}
              selectedIdx={selectedIdx}
              totalWindows={windows.length}
              summitElevation={data.summitElevationM}
              onPrev={() => setSelectedIdx(Math.max(0, selectedIdx - 1))}
              onNext={() => setSelectedIdx(Math.min(windows.length - 1, selectedIdx + 1))}
            />
            <PeakCard form={form} setForm={setForm} data={data} onAnalyze={handleAnalyze} loading={busy} />
          </div>

          <WeekOverview
            hours={data.hours}
            windows={windows}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
          />

          <WindowsList
            windows={windows}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
          />

          <HorizonTape
            hours={data.hours}
            times={data.series.time}
            sunMarkers={sunMarkers}
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
                    <strong>{data.gridElevationM} m</strong>
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
              <MountainProfile data={data} cursorIdx={cursor?.idx ?? null} />
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
              Source: {data.source} &middot; fetched {new Date(data.fetchedAt).toLocaleString()}
            </div>
          </div>
        </>
      )}

      {data && <FloatingTooltip data={data} cursor={cursor} />}
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
