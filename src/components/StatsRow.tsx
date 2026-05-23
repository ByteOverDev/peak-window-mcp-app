import { Clock, Droplets, Snowflake, Thermometer, Wind } from "lucide-react";
import type { PeakWindowResult } from "../types.ts";
import s from "./StatsRow.module.css";

interface StatsRowProps {
  data: PeakWindowResult;
}

function Stat({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit?: string }) {
  return (
    <div className={s.stat}>
      <div className={s.label}>{icon}{label}</div>
      <div className={s.value}>{value}{unit && <span className={s.unit}> {unit}</span>}</div>
    </div>
  );
}

export function StatsRow({ data }: StatsRowProps) {
  const ser = data.series;
  const temps = ser.t2m.filter((v): v is number => v != null);
  const tMin = temps.length ? Math.min(...temps) : null;
  const tMax = temps.length ? Math.max(...temps) : null;
  const peakGust = Math.max(...ser.fx.filter((v): v is number => v != null), 0);
  const totalPrecip = ser.rr.reduce((a: number, b) => a + (b ?? 0), 0);
  const totalSnow = ser.snow.reduce((a: number, b) => a + (b ?? 0), 0);
  const horizon = ser.time.length;

  return (
    <div className={s.stats}>
      <Stat icon={<Thermometer size={11} />} label="Temp range"
        value={`${tMin?.toFixed(0) ?? "—"}° → ${tMax?.toFixed(0) ?? "—"}°`} />
      <Stat icon={<Wind size={11} />} label="Peak gust"
        value={peakGust.toFixed(1)} unit="m/s" />
      <Stat icon={<Droplets size={11} />} label="Total precip"
        value={totalPrecip.toFixed(1)} unit="mm" />
      <Stat icon={<Snowflake size={11} />} label="Total snow"
        value={totalSnow.toFixed(1)} unit="mm" />
      <Stat icon={<Clock size={11} />} label="Horizon"
        value={String(horizon)} unit="h" />
    </div>
  );
}
