import React, { useEffect, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SettingsForm } from "@/components/widget/SettingsForm";
import { useAppInit } from "@/hooks/useAppInit";
import { resolveLocale, t } from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import "./index.css";

function SettingsApp() {
  useAppInit(false);

  const localeMode = useSettingsStore((s) => s.localeMode);
  const panelOpacity = useSettingsStore((s) => s.panelOpacity);
  const clockCollapsed = useSettingsStore((s) => s.clockCollapsed);
  const autoStart = useSettingsStore((s) => s.autoStart);
  const theme = useSettingsStore((s) => s.theme);
  const setLocaleMode = useSettingsStore((s) => s.setLocaleMode);
  const setPanelOpacity = useSettingsStore((s) => s.setPanelOpacity);
  const setClockCollapsed = useSettingsStore((s) => s.setClockCollapsed);
  const setAutoStart = useSettingsStore((s) => s.setAutoStart);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const locale = useMemo(() => resolveLocale(localeMode), [localeMode]);
  const heading = useMemo(
    () => `${t(locale, "appName")} · ${t(locale, "settings")}`,
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    const title = `${t(locale, "appName")} · ${t(locale, "settings")}`;
    getCurrentWindow()
      .setTitle(title)
      .catch(() => {
        document.title = title;
      });
  }, [locale, localeMode]);

  return (
    <ErrorBoundary>
      <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
        <header className="shrink-0 border-b border-neutral-200 px-4 py-3">
          <h1 className="text-lg font-semibold text-neutral-900">{heading}</h1>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <SettingsForm
            locale={locale}
            localeMode={localeMode}
            onSetLocaleMode={setLocaleMode}
            panelOpacity={panelOpacity}
            onPanelOpacityChange={setPanelOpacity}
            clockCollapsed={clockCollapsed}
            onSetClockCollapsed={setClockCollapsed}
            autoStart={autoStart}
            onSetAutoStart={setAutoStart}
            theme={theme}
            onSetTheme={setTheme}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>,
);
