import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** 专注模式顶栏拖拽区高度（与 FocusDragHandle h-4 一致） */
export const FOCUS_DRAG_HANDLE_HEIGHT = 16;

/** 专注模式单行高度（与 FocusTodoRow min-h-12 一致） */
export const FOCUS_ROW_HEIGHT = 48;

/** 专注模式列表最多展示行数，超出在列表内滚动 */
export const FOCUS_MAX_VISIBLE_ROWS = 5;

/** 专注模式列表区最大高度（不含拖拽条） */
export const FOCUS_MAX_LIST_HEIGHT = FOCUS_MAX_VISIBLE_ROWS * FOCUS_ROW_HEIGHT;

/** 无未完成事项时列表区高度（不含拖拽条） */
export const FOCUS_EMPTY_CONTENT_HEIGHT = 104;

/** 无未完成事项时的窗口总高度 */
export const FOCUS_EMPTY_HEIGHT =
  FOCUS_DRAG_HANDLE_HEIGHT + FOCUS_EMPTY_CONTENT_HEIGHT;

export const FOCUS_MIN_HEIGHT = FOCUS_DRAG_HANDLE_HEIGHT + FOCUS_ROW_HEIGHT;
export const FOCUS_MAX_HEIGHT = FOCUS_DRAG_HANDLE_HEIGHT + FOCUS_MAX_LIST_HEIGHT;

export const DEFAULT_FULL_WINDOW_WIDTH = 360;
export const DEFAULT_FULL_WINDOW_HEIGHT = 620;

export type WindowLogicalSize = { width: number; height: number };

export function computeFocusWindowHeight(activeCount: number): number {
  if (activeCount <= 0) return FOCUS_EMPTY_HEIGHT;
  const listHeight = activeCount * FOCUS_ROW_HEIGHT;
  const total = FOCUS_DRAG_HANDLE_HEIGHT + listHeight;
  return Math.min(FOCUS_MAX_HEIGHT, Math.max(FOCUS_MIN_HEIGHT, total));
}

export async function readWindowInnerSize(): Promise<WindowLogicalSize | null> {
  try {
    const size = await getCurrentWindow().innerSize();
    return { width: size.width, height: size.height };
  } catch {
    return null;
  }
}

export async function setWindowLogicalSize(size: WindowLogicalSize): Promise<void> {
  try {
    await getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
  } catch {
    /* 浏览器预览 */
  }
}

export async function applyFocusWindowHeight(
  activeCount: number,
  width: number,
): Promise<void> {
  const height = computeFocusWindowHeight(activeCount);
  await setWindowLogicalSize({ width, height });
}
