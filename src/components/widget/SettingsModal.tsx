import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Locale, LocaleMode } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { t } from "@/i18n";
import type { ThemeId } from "@/lib/db";

interface SettingsModalProps {
  open: boolean;
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
  reminderMode: "popup" | "system";
  onSetReminderMode: (m: "popup" | "system") => void;
  onClose: () => void;
}

/* ──────────── Switch 滑动开关 ──────────── */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span style={{ color: "var(--ln-theme-text)" }} className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
        style={{ background: checked ? "#0ea5e9" : "var(--ln-theme-text-muted)" }}
      >
        <span
          className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? "translateX(20px)" : "translateX(4px)" }}
        />
      </button>
    </label>
  );
}

/* ──────────── CustomSelect 自定义下拉 ──────────── */
function CustomSelect<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // 延迟绑定，避免打开时的 click 事件立刻触发关闭
    const id = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handler);
    };
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const curLabel = options.find((o) => o.value === value)?.label ?? "";

  // 计算下拉面板位置
  const getPopStyle = useCallback((): React.CSSProperties => {
    if (!btnRef.current) return {};
    const rect = btnRef.current.getBoundingClientRect();
    return {
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 60,
    };
  }, []);

  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "var(--ln-theme-text)" }} className="text-sm shrink-0 mr-3">
        {label}
      </span>
      <div className="flex-1 max-w-[140px]">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm"
          style={{
            background: "var(--ln-theme-surface)",
            color: "var(--ln-theme-text)",
            border: `1px solid var(--ln-theme-border)`,
          }}
        >
          <span>{curLabel}</span>
          <svg className="h-3 w-3 shrink-0 ml-1" viewBox="0 0 12 12" fill="none">
            <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open &&
          createPortal(
            <div
              ref={listRef}
              style={getPopStyle()}
              className="rounded-lg overflow-hidden shadow-xl"
            >
              <div
                style={{
                  background: "var(--ln-theme-bg)",
                  backdropFilter: "var(--ln-theme-backdrop)",
                  border: `1px solid var(--ln-theme-border)`,
                  borderRadius: "inherit",
                }}
              >
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-sm transition-colors"
                    style={{
                      color: "var(--ln-theme-text)",
                      background:
                        opt.value === value
                          ? "var(--ln-theme-surface-active)"
                          : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (opt.value !== value)
                        (e.target as HTMLElement).style.background = "var(--ln-theme-surface-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (opt.value !== value)
                        (e.target as HTMLElement).style.background = "transparent";
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}

export function SettingsModal({
  open,
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
  reminderMode,
  onSetReminderMode,
  onClose,
}: SettingsModalProps) {
  const mk = (key: MessageKey) => t(locale, key);
  const overlayRef = useRef<HTMLDivElement>(null);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--ln-theme-overlay)" }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="w-[320px] max-h-[90%] overflow-y-auto rounded-lg px-5 py-5 shadow-2xl"
        style={{ background: "var(--ln-theme-bg)", backdropFilter: "var(--ln-theme-backdrop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: "var(--ln-theme-text)" }}>
            {mk("settings")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/10"
            style={{ color: "var(--ln-theme-text-secondary)" }}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 外观 */}
        <section className="mb-5 space-y-4">
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--ln-theme-text)" }} className="text-sm">{mk("opacityLabel")}</span>
            <span className="text-xs w-8 text-right" style={{ color: "var(--ln-theme-text-secondary)" }}>
              {Math.round(panelOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={15}
            max={100}
            value={Math.round(panelOpacity * 100)}
            onChange={(e) => onPanelOpacityChange(Number(e.target.value) / 100)}
            className="w-full h-6 rounded-full appearance-none cursor-pointer bg-transparent"
            style={{
              WebkitAppearance: "none",
              appearance: "none" as React.CSSProperties["appearance"],
            }}
          />
          <style>{`
            input[type="range"]::-webkit-slider-runnable-track {
              height: 6px;
              border-radius: 999px;
              background: var(--ln-theme-text-muted);
            }
            input[type="range"]::-webkit-slider-thumb {
              -webkit-appearance: none;
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: white;
              margin-top: -5px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
              cursor: pointer;
            }
            input[type="range"]::-moz-range-track {
              height: 6px;
              border-radius: 999px;
              background: var(--ln-theme-text-muted);
            }
            input[type="range"]::-moz-range-thumb {
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: white;
              border: none;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
              cursor: pointer;
            }
          `}</style>
        </section>

        {/* 功能开关 */}
        <section className="mb-5 space-y-4">
          <Switch
            checked={!clockCollapsed}
            onChange={(v) => onSetClockCollapsed(!v)}
            label={mk("showClockSection")}
          />
          <Switch
            checked={autoStart}
            onChange={onSetAutoStart}
            label={mk("autoStart")}
          />
        </section>

        {/* 分隔线 */}
        <div className="mb-5" style={{ borderTop: `1px solid var(--ln-theme-border-light)` }} />

        {/* 提醒方式 */}
        <section className="mb-4">
          <CustomSelect
            label={mk("reminderModeLabel")}
            value={reminderMode}
            onChange={onSetReminderMode}
            options={[
              { value: "popup" as const, label: mk("reminderModePopup") },
              { value: "system" as const, label: mk("reminderModeSystem") },
            ]}
          />
        </section>
        <div className="mb-5" style={{ borderTop: `1px solid var(--ln-theme-border-light)` }} />

        {/* 主题 */}
        <section className="mb-4">
          <CustomSelect
            label={mk("themeLabel")}
            value={theme}
            onChange={onSetTheme}
            options={[
              { value: "glass" as const, label: mk("themeGlass") },
              { value: "dark" as const, label: mk("themeDark") },
              { value: "light" as const, label: mk("themeLight") },
            ]}
          />
        </section>

        {/* 语言 */}
        <section>
          <CustomSelect
            label={mk("language")}
            value={localeMode}
            onChange={onSetLocaleMode}
            options={[
              { value: "system" as const, label: mk("langSystem") },
              { value: "zh-CN" as const, label: mk("langZh") },
              { value: "en" as const, label: mk("langEn") },
            ]}
          />
        </section>

        {/* 分隔线 */}
        <div className="my-5" style={{ borderTop: `1px solid var(--ln-theme-border-light)` }} />

        {/* 快捷键（只读） */}
        <section>
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--ln-theme-text)" }}>
              {mk("shortcutLabel")}
            </span>
            <span className="text-sm" style={{ color: "var(--ln-theme-text-muted)" }}>
              {mk("shortcutValue")}
            </span>
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--ln-theme-text-muted)" }}>
            {locale === "zh-CN" ? "全局显示 / 隐藏窗口" : "Show / hide window globally"}
          </p>
        </section>
      </div>
    </div>,
    document.body,
  );
}
