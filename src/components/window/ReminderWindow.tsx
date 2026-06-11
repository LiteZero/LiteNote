import { useEffect, useMemo, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolveLocale, t } from "@/i18n";

/**
 * 钉钉式提醒弹窗。
 * - 通过 ?window=reminder&todoId=...&text=...&dueDate=... 加载
 * - 操作通过 invoke('reminder_action') 通知 Rust
 * - 操作完成后 Rust 端会关闭本窗口
 *
 * WebView 固定 380 × 180。点击「稍后提醒」按钮，向上弹出横排药丸
 * + 自定义输入行组成的 popover。
 */
export function ReminderWindow() {
  const localeMode = useSettingsStore((s) => s.localeMode);
  const locale = resolveLocale(localeMode);

  const params = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    return {
      todoId: sp.get("todoId") ?? "",
      text: sp.get("text") ?? "",
      dueDate: Number(sp.get("dueDate") ?? 0),
    };
  }, []);

  const text = params.text || t(locale, "emptyTodo");
  const dueLabel = formatDueLabel(params.dueDate, locale);

  const [expanded, setExpanded] = useState(false);
  const [customMinutes, setCustomMinutes] = useState("30");
  const [busy, setBusy] = useState(false);
  const snoozeBtnRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // 标记 html 根节点为 reminder 模式（用于 index.css 的无边框样式）
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("ln-reminder");
    return () => {
      root.classList.remove("ln-reminder");
    };
  }, []);

  // 点击弹窗外区域关闭 popover
  useEffect(() => {
    if (!expanded) return;
    const onDocDown = (e: MouseEvent) => {
      const t0 = e.target as Node;
      if (
        popoverRef.current?.contains(t0) ||
        snoozeBtnRef.current?.contains(t0)
      )
        return;
      setExpanded(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [expanded]);

  const callAction = async (
    action: "snooze" | "close",
    delayMinutes?: number,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      await invoke("reminder_action", {
        todoId: params.todoId,
        action,
        delayMinutes: delayMinutes ?? null,
      });
      // 通知其他窗口（主窗口）重新从 DB 加载 todo 数据
      emit("litenote-todos-updated", { ts: Date.now() }).catch(() => {});
      setTimeout(() => {
        getCurrentWindow().close().catch(() => {});
      }, 200);
    } catch (e) {
      console.error("[ReminderWindow] action failed", e);
      setBusy(false);
    }
  };

  const onSnoozePreset = (mins: number) => {
    setExpanded(false);
    void callAction("snooze", mins);
  };

  const onSnoozeCustom = () => {
    const n = Math.max(
      1,
      Math.min(24 * 60, Math.floor(Number(customMinutes) || 0)),
    );
    if (n <= 0) return;
    setExpanded(false);
    void callAction("snooze", n);
  };

  const onCustomKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onSnoozeCustom();
  };

  const unitLabel = locale === "zh-CN" ? "分钟" : "min";

  return (
    <div className="reminder-root" data-tauri-drag-region>
      <div className="reminder-card" data-tauri-drag-region>
        <div className="reminder-header">
          <span className="reminder-dot" />
          <span className="reminder-title">
            {t(locale, "reminderWindowTitle")}
          </span>
          <button
            className="reminder-close"
            aria-label="close"
            data-tauri-no-drag
            onClick={() => callAction("close")}
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="reminder-body">
          <div className="reminder-text" title={text}>
            {text}
          </div>
          {dueLabel && <div className="reminder-due">{dueLabel}</div>}
        </div>

        <div className="reminder-actions" data-tauri-no-drag>
          <button
            className="reminder-btn reminder-btn-primary"
            disabled={busy}
            onClick={() => callAction("close")}
          >
            {t(locale, "reminderActionDone")}
          </button>

          <div className="reminder-snooze-wrap" data-tauri-no-drag>
            <button
              ref={snoozeBtnRef}
              className="reminder-btn"
              disabled={busy}
              onClick={() => setExpanded((v) => !v)}
            >
              {t(locale, "reminderActionSnooze")} ▴
            </button>

            {expanded && (
              <div ref={popoverRef} className="reminder-popover">
                <div className="reminder-pill-row">
                  {[5, 10, 15, 30].map((m) => (
                    <button
                      key={m}
                      className="reminder-pill"
                      disabled={busy}
                      onClick={() => onSnoozePreset(m)}
                    >
                      {m} {unitLabel}
                    </button>
                  ))}
                </div>
                <div className="reminder-custom-row">
                  <input
                    className="reminder-custom-input"
                    type="number"
                    min={1}
                    max={1440}
                    value={customMinutes}
                    onChange={(e) => setCustomMinutes(e.target.value)}
                    onKeyDown={onCustomKeyDown}
                    disabled={busy}
                  />
                  <span className="reminder-custom-unit">{unitLabel}</span>
                  <button
                    className="reminder-custom-ok"
                    disabled={busy}
                    onClick={onSnoozeCustom}
                  >
                    {t(locale, "reminderSnoozeConfirm")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ReminderStyles />
    </div>
  );
}

/**
 * 把 dueDate(ms) 转成可读字符串
 */
function formatDueLabel(dueDate: number, locale: "zh-CN" | "en"): string {
  if (!dueDate || dueDate <= 0) return "";
  const now = Date.now();
  const diff = dueDate - now;

  if (Math.abs(diff) < 30_000) {
    return t(locale, "reminderOverdueNow");
  }

  const abs = Math.abs(diff);
  const totalMin = Math.floor(abs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  const isZh = locale === "zh-CN";
  let timeStr = "";
  if (h > 0) timeStr += isZh ? `${h}小时` : `${h}h`;
  if (m > 0 || h === 0) timeStr += isZh ? `${m}分钟` : `${m} min`;

  return diff > 0
    ? t(locale, "reminderDueIn", { time: timeStr })
    : t(locale, "reminderOverdue", { time: timeStr });
}

/**
 * 弹窗独立样式：复用 token，不污染主窗口
 */
function ReminderStyles() {
  return (
    <style>{`
      .reminder-root {
        position: fixed;
        inset: 0;
        background: transparent;
        display: flex;
        align-items: flex-end;            /* 卡片贴 WebView 底部 */
        justify-content: stretch;
        font-family: var(--ln-font-stack, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif);
        -webkit-user-select: none;
        user-select: none;
        margin: 0;
        padding: 0;
      }
      .reminder-card {
        width: 100%;
        height: 160px;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08);
        color: #1a1a1a;
        display: flex;
        flex-direction: column;
        overflow: visible;                 /* 允许 popover 溢出到卡片上方 */
        position: relative;
        box-sizing: border-box;
      }

      /* ─── header ─── */
      .reminder-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px 4px;
        flex-shrink: 0;
      }
      .reminder-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #ff9500;
        flex-shrink: 0;
      }
      .reminder-title {
        flex: 1;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.2px;
        color: #666;
      }
      .reminder-close {
        background: transparent;
        border: 0;
        color: #999;
        font-size: 16px;
        line-height: 1;
        width: 20px; height: 20px;
        border-radius: 4px;
        cursor: pointer;
      }
      .reminder-close:hover { background: rgba(0,0,0,0.06); color: #333; }

      /* ─── body ─── */
      .reminder-body {
        padding: 2px 14px 6px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex-shrink: 0;
        min-height: 0;
      }
      .reminder-text {
        font-size: 15px;
        font-weight: 500;
        line-height: 1.3;
        color: #1a1a1a;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
      }
      .reminder-due {
        font-size: 11px;
        color: #999;
      }

      /* ─── 底部 双按钮 ─── */
      .reminder-actions {
        display: flex;
        gap: 8px;
        padding: 4px 14px 10px;
        margin-top: auto;
        flex-shrink: 0;
      }
      .reminder-btn {
        flex: 1;
        height: 30px;
        border-radius: 8px;
        border: 1px solid #e0e0e0;
        background: #f5f5f5;
        color: #333;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .reminder-btn:hover { background: #ebebeb; }
      .reminder-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .reminder-btn-primary {
        background: #ff9500;
        border-color: transparent;
        color: #fff;
        font-weight: 600;
      }
      .reminder-btn-primary:hover { background: #ffa624; }
      .reminder-snooze-wrap { position: relative; flex: 1; display: flex; }
      .reminder-snooze-wrap .reminder-btn { width: 100%; }

      /* ─── popover：从「稍后提醒」按钮上方弹出 ─── */
      .reminder-popover {
        position: absolute;
        bottom: calc(100% + 6px);
        right: 0;
        min-width: 280px;
        background: #fff;
        border: 1px solid #e8e8e8;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        padding: 8px;
        z-index: 100;
        display: flex;
        flex-direction: column;
        gap: 6px;
        animation: slideUp 0.18s ease-out;
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .reminder-pill-row {
        display: flex;
        gap: 6px;
      }
      .reminder-pill {
        flex: 1;
        height: 28px;
        border-radius: 14px;
        border: 1px solid #e0e0e0;
        background: #f5f5f5;
        color: #333;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
      }
      .reminder-pill:hover { background: #ebebeb; }
      .reminder-pill:active { background: rgba(255,149,0,0.15); }
      .reminder-pill:disabled { opacity: 0.5; cursor: not-allowed; }

      .reminder-custom-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .reminder-custom-input {
        width: 56px;
        height: 26px;
        background: #f5f5f5;
        border: 1px solid #e0e0e0;
        border-radius: 5px;
        color: #333;
        font-size: 12px;
        padding: 0 6px;
        outline: none;
        text-align: center;
      }
      .reminder-custom-input:focus { border-color: #ff9500; }
      .reminder-custom-input:disabled { opacity: 0.5; }
      .reminder-custom-unit {
        font-size: 11px;
        color: #999;
      }
      .reminder-custom-ok {
        margin-left: auto;
        height: 26px;
        padding: 0 14px;
        border-radius: 5px;
        border: 0;
        background: #ff9500;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }
      .reminder-custom-ok:hover { background: #ffa624; }
      .reminder-custom-ok:disabled { opacity: 0.5; cursor: not-allowed; }
    `}</style>
  );
}
