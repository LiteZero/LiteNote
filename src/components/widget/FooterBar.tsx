import type { Locale } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { t } from "@/i18n";

interface FooterBarProps {
  locale: Locale;
  onAdd: () => void;
  onClearClick: () => void;
  /** 无已完成项时禁用清除按钮 */
  clearCompletedDisabled?: boolean;
}

export function FooterBar({
  locale,
  onAdd,
  onClearClick,
  clearCompletedDisabled = false,
}: FooterBarProps) {
  const mk = (key: MessageKey) => t(locale, key);

  const btnBase =
    "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition";
  const btnActive = `${btnBase} hover:bg-[var(--ln-theme-surface-hover)]`;
  const btnDisabled = `${btnBase} cursor-not-allowed`;

  const btnStyle = { color: "var(--ln-theme-text)" };
  const btnDisabledStyle = { color: "var(--ln-theme-text-muted)" };

  return (
    <footer
      className="shrink-0 px-2 py-2"
      style={{ borderTop: `1px solid var(--ln-theme-border)`, background: "var(--ln-theme-surface)" }}
      data-tauri-no-drag
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          title={mk("footerAddTooltip")}
          onClick={onAdd}
          className={btnActive}
          style={btnStyle}
        >
          <svg
            className="h-4 w-4 shrink-0 opacity-95"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          {mk("footerAdd")}
        </button>
        <button
          type="button"
          title={
            clearCompletedDisabled ? undefined : mk("footerClearTooltip")
          }
          disabled={clearCompletedDisabled}
          onClick={onClearClick}
          className={clearCompletedDisabled ? btnDisabled : btnActive}
          style={clearCompletedDisabled ? btnDisabledStyle : btnStyle}
        >
          <svg
            className="h-4 w-4 shrink-0 opacity-95"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M9 3h6l1 2h5v2H3V5h5l1-2Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M6 9h12l-1 12H7L6 9Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M10 13v6M14 13v6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          {mk("footerClear")}
        </button>
      </div>
    </footer>
  );
}
