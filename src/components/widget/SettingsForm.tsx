import type { Locale, LocaleMode } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { t } from "@/i18n";
import type { ThemeId } from "@/lib/db";

interface SettingsFormProps {
  locale: Locale;
  localeMode: LocaleMode;
  onSetLocaleMode: (m: LocaleMode) => void;
  panelOpacity: number;
  onPanelOpacityChange: (v: number) => void;
  clockCollapsed: boolean;
  onSetClockCollapsed: (v: boolean) => void;
  autoStart: boolean;
  onSetAutoStart: (v: boolean) => void;
  theme: ThemeId;
  onSetTheme: (t: ThemeId) => void;
}

const row =
  "flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900";
const sectionTitle =
  "mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500";

export function SettingsForm({
  locale,
  localeMode,
  onSetLocaleMode,
  panelOpacity,
  onPanelOpacityChange,
  clockCollapsed,
  onSetClockCollapsed,
  autoStart,
  onSetAutoStart,
  theme,
  onSetTheme,
}: SettingsFormProps) {
  const mk = (key: MessageKey) => t(locale, key);

  return (
    <div className="space-y-6">
      <section>
        <h3 className={sectionTitle}>{mk("settingsAppearance")}</h3>
        <div className="space-y-3">
          <label
            className={`${row} flex-col items-stretch gap-2 sm:flex-row sm:items-center`}
          >
            <span className="shrink-0">{mk("opacityLabel")}</span>
            <input
              type="range"
              min={15}
              max={100}
              value={Math.round(panelOpacity * 100)}
              onChange={(e) => onPanelOpacityChange(Number(e.target.value) / 100)}
              className="h-1 w-full accent-sky-500 sm:flex-1"
            />
          </label>
          <label className={`${row} cursor-pointer`}>
            <span>{mk("showClockSection")}</span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-sky-500"
              checked={!clockCollapsed}
              onChange={(e) => onSetClockCollapsed(!e.target.checked)}
            />
          </label>
          <label className={`${row} cursor-pointer`}>
            <span>{mk("autoStart")}</span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-sky-500"
              checked={autoStart}
              onChange={(e) => onSetAutoStart(e.target.checked)}
            />
          </label>
        </div>
      </section>

      <section>
        <h3 className={sectionTitle}>{mk("themeLabel")}</h3>
        <div
          className="space-y-1 rounded-lg border border-neutral-200 bg-white p-1"
          role="radiogroup"
          aria-label={mk("themeLabel")}
        >
          {(
            [
              ["glass", "themeGlass"] as const,
              ["dark", "themeDark"] as const,
              ["light", "themeLight"] as const,
            ] as const
          ).map(([mode, labelKey]) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-900 hover:bg-neutral-100 has-[:focus-visible]:bg-neutral-100"
            >
              <input
                type="radio"
                name="theme"
                className="accent-sky-500"
                checked={theme === mode}
                onChange={() => onSetTheme(mode)}
              />
              <span>{mk(labelKey)}</span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3 className={sectionTitle}>{mk("settingsLanguage")}</h3>
        <div
          className="space-y-1 rounded-lg border border-neutral-200 bg-white p-1"
          role="radiogroup"
          aria-label={mk("language")}
        >
          {(
            [
              ["system", "langSystem"] as const,
              ["zh-CN", "langZh"] as const,
              ["en", "langEn"] as const,
            ] as const
          ).map(([mode, labelKey]) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-900 hover:bg-neutral-100 has-[:focus-visible]:bg-neutral-100"
            >
              <input
                type="radio"
                name="locale-mode"
                className="accent-sky-500"
                checked={localeMode === mode}
                onChange={() => onSetLocaleMode(mode)}
              />
              <span>{mk(labelKey)}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
