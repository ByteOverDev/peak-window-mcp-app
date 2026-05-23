import { MapPin, Search } from "lucide-react";
import type { PeakWindowResult } from "../types.ts";
import s from "./PeakCard.module.css";

export interface PeakForm {
  peakName: string;
  lat: string;
  lon: string;
  summitElevationM: string;
}

interface PeakCardProps {
  form: PeakForm;
  setForm: (f: PeakForm) => void;
  data: PeakWindowResult;
  onAnalyze: () => void;
  loading: boolean;
}

export function PeakCard({ form, setForm, data, onAnalyze, loading }: PeakCardProps) {
  return (
    <div className={s.card}>
      <div>
        <div className={s.eyebrow}>Climbing</div>
        <div className={s.peakName}>
          {form.peakName || "Unknown peak"}
          <span className={s.peakLoc}>
            <MapPin size={11} />
            {Number(form.lat).toFixed(3)}&deg;N, {Number(form.lon).toFixed(3)}&deg;E
          </span>
        </div>
      </div>

      <div className={s.elev}>
        {data.summitElevationM != null && (
          <div className={s.elevRow}>
            <div className={s.elevKey}>Summit</div>
            <div className={`${s.elevVal} ${s.summit}`}>{data.summitElevationM.toLocaleString()} m</div>
          </div>
        )}
        {data.gridElevationM != null && (
          <div className={s.elevRow}>
            <div className={s.elevKey}>Grid</div>
            <div className={s.elevValSmall}>{data.gridElevationM.toLocaleString()} m</div>
          </div>
        )}
        {data.lapseDeltaC != null && (
          <div className={s.elevRow}>
            <div className={s.elevKey}>Lapse &Delta;</div>
            <div className={`${s.elevVal} ${s.lapse}`}>{data.lapseDeltaC.toFixed(1)}&deg;C</div>
          </div>
        )}
      </div>

      <div>
        <div className={s.eyebrow} style={{ marginBottom: 8 }}>Refine</div>
        <div className={s.pills}>
          <label className={`${s.pill} ${s.pillPeak}`}>
            <span className={s.pillK}>Peak</span>
            <input type="text" value={form.peakName}
              onChange={(e) => setForm({ ...form, peakName: e.target.value })} />
          </label>
          <label className={`${s.pill} ${s.pillCoord}`}>
            <span className={s.pillK}>Lat</span>
            <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
          </label>
          <label className={`${s.pill} ${s.pillCoord}`}>
            <span className={s.pillK}>Lon</span>
            <input value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })} />
          </label>
          <label className={`${s.pill} ${s.pillElev}`}>
            <span className={s.pillK}>Elev m</span>
            <input value={form.summitElevationM}
              onChange={(e) => setForm({ ...form, summitElevationM: e.target.value })} />
          </label>
        </div>
        <div className={s.refineActions}>
          <div className={s.refineHint}>Edit any field, then re-run the climb-window search.</div>
          <button className={s.analyze} onClick={onAnalyze} disabled={loading}>
            {loading ? <span className={s.spin} /> : <Search size={13} />}
            {loading ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>
    </div>
  );
}
