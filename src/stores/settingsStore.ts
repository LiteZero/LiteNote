import { create } from "zustand";
import type { LocaleMode } from "@/i18n";
import {
  loadSettings,
  saveSetting,
  DEFAULT_SETTINGS,
} from "@/lib/db";

// ──────────────── 类型定义 ────────────────

export interface SettingsState {
  clockCollapsed: boolean;
  panelOpacity: number;
  localeMode: LocaleMode;
  alwaysOnTop: boolean;
  autoStart: boolean;
  initialized: boolean;
  /** 最近一次 DB 写入错误信息，供 UI 展示 */
  lastError: string | null;
}

export interface SettingsActions {
  init: () => Promise<void>;
  setPanelOpacity: (v: number) => void;
  setLocaleMode: (m: LocaleMode) => void;
  setClockCollapsed: (v: boolean) => void;
  setAlwaysOnTop: (v: boolean) => void;
  setAutoStart: (v: boolean) => void;
  /** 供外部同步调用：用 DB 最新值覆盖 store */
  reloadFromDb: () => Promise<void>;
  clearError: () => void;
}

// ──────────────── 异步 DB 写（带错误反馈） ────────────────

function dbWrite(
  promise: Promise<unknown>,
  label: string,
  onError: (msg: string) => void,
  onSuccess?: () => void,
): void {
  promise
    .then(() => {
      console.log(`[LiteNote] ${label} ✅`);
      onSuccess?.();
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[LiteNote] ${label} ❌`, e);
      onError(`${label} 失败: ${msg}`);
    });
}

// ──────────────── Store ────────────────

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  (set) => ({
    ...DEFAULT_SETTINGS,
    initialized: false,
    lastError: null,

    clearError: () => set({ lastError: null }),

    init: async () => {
      const settings = await loadSettings();
      set({ ...settings, initialized: true });

      // 启动时同步 autostart 插件状态与保存的设置
      if (settings.autoStart) {
        import("@tauri-apps/plugin-autostart")
          .then(({ enable }) => {
            enable().catch((e) =>
              console.error("[LiteNote] autostart init enable failed:", e),
            );
          })
          .catch((e) =>
            console.error("[LiteNote] autostart import failed:", e),
          );
      }
    },

    reloadFromDb: async () => {
      try {
        const settings = await loadSettings();
        set({ ...settings });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ lastError: `加载设置失败: ${msg}` });
      }
    },

    setPanelOpacity: (v) => {
      const val = Math.min(1, Math.max(0.15, v));
      set({ panelOpacity: val });
      dbWrite(
        saveSetting("panelOpacity", val),
        "saveSetting(panelOpacity)",
        (msg) => set({ lastError: msg }),
        emitSettingsChanged,
      );
    },

    setLocaleMode: (m) => {
      set({ localeMode: m });
      dbWrite(
        saveSetting("localeMode", m),
        "saveSetting(localeMode)",
        (msg) => set({ lastError: msg }),
        emitSettingsChanged,
      );
    },

    setClockCollapsed: (v) => {
      set({ clockCollapsed: v });
      dbWrite(
        saveSetting("clockCollapsed", v),
        "saveSetting(clockCollapsed)",
        (msg) => set({ lastError: msg }),
        emitSettingsChanged,
      );
    },

    setAlwaysOnTop: (v) => {
      set({ alwaysOnTop: v });
      dbWrite(
        saveSetting("alwaysOnTop", v),
        "saveSetting(alwaysOnTop)",
        (msg) => set({ lastError: msg }),
        emitSettingsChanged,
      );
    },

    setAutoStart: (v) => {
      set({ autoStart: v });
      // 同步调用 autostart 插件启用/禁用
      import("@tauri-apps/plugin-autostart").then(({ enable, disable }) => {
        if (v) {
          enable().catch((e) => console.error("[LiteNote] autostart enable failed:", e));
        } else {
          disable().catch((e) => console.error("[LiteNote] autostart disable failed:", e));
        }
      }).catch((e) => console.error("[LiteNote] autostart import failed:", e));

      dbWrite(
        saveSetting("autoStart", v),
        "saveSetting(autoStart)",
        (msg) => set({ lastError: msg }),
        emitSettingsChanged,
      );
    },
  }),
);

// ──────────────── 跨窗口设置同步 ────────────────

const SETTINGS_EVENT = "litenote-settings-updated";

type SettingsUpdatedPayload = { ts: number; source?: string };

function emitSettingsChanged(): void {
  Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
  ])
    .then(([{ emit }, { getCurrentWindow }]) => {
      let source: string | undefined;
      try {
        source = getCurrentWindow().label;
      } catch {
        source = undefined;
      }
      const payload: SettingsUpdatedPayload = { ts: Date.now(), source };
      void emit(SETTINGS_EVENT, payload);
    })
    .catch(() => {});
}

async function shouldReloadFromSettingsEvent(
  payload: SettingsUpdatedPayload,
): Promise<boolean> {
  if (!payload.source) return true;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label !== payload.source;
  } catch {
    return true;
  }
}

let _syncInitDone = false;

export function initSettingsSync(): () => void {
  if (_syncInitDone) return () => {};
  _syncInitDone = true;

  let unlisten: (() => void) | null = null;

  import("@tauri-apps/api/event")
    .then(({ listen }) => {
      listen<SettingsUpdatedPayload>(SETTINGS_EVENT, (event) => {
        void shouldReloadFromSettingsEvent(event.payload).then((reload) => {
          if (reload) {
            void useSettingsStore.getState().reloadFromDb();
          }
        });
      })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    })
    .catch(() => {});

  return () => {
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
    _syncInitDone = false;
  };
}
