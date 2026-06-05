import { useEffect, useState } from "react";
import type { Locale } from "@/i18n";
import { formatLunarLine } from "@/lib/lunarLine";

interface ClockSectionProps {
  locale: Locale;
}

export function ClockSection({ locale }: ClockSectionProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const dateStr = now.toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
  });

  const weekdayStr = now.toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    weekday: "long",
  });

  const lunar = formatLunarLine(now, locale);

  return (
    <section className="shrink-0 cursor-default select-none px-3 py-6" style={{ borderBottom: `1px solid var(--ln-theme-border)` }}>
      <div className="text-center font-mono text-5xl font-light leading-none tabular-nums tracking-wide" style={{ color: "var(--ln-theme-text)" }}>
        {timeStr}
      </div>
      <div className="mt-4 flex justify-between gap-1 px-1 text-xs" style={{ color: "var(--ln-theme-text-secondary)" }}>
        <span className="min-w-0 shrink truncate">{lunar}</span>
        <span className="shrink-0">{dateStr}</span>
        <span className="min-w-0 shrink truncate text-right">{weekdayStr}</span>
      </div>
    </section>
  );
}
