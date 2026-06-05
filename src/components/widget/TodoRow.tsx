import { useEffect, useMemo, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Locale } from "@/i18n";
import { t } from "@/i18n";
import { COLOR_DOT_STYLE } from "@/lib/itemColors";
import { formatDueDate } from "@/lib/dueDate";
import { formatRecurrence, computeNextDueDate } from "@/lib/recurrence";
import type { TodoItem } from "@/types/todo";
import { useNow } from "@/hooks/useNow";

interface TodoRowProps {
  todo: TodoItem;
  locale: Locale;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onChangeText: (text: string) => void;
  onEndEdit: () => void;
  onToggleCompleted: () => void;
}

export function TodoRow({
  todo,
  locale,
  selected,
  editing,
  onSelect,
  onContextMenu,
  onChangeText,
  onEndEdit,
  onToggleCompleted,
}: TodoRowProps) {
  const accent = COLOR_DOT_STYLE[todo.colorId].background;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 仅未完成且非编辑态的待办可拖拽
  const sortable = useSortable({
    id: todo.id,
    disabled: todo.completed || editing,
    data: { type: "todo" as const },
  });

  // 每分钟刷新当前时间戳，确保逾期状态能自动更新
  const now = useNow(60_000);

  const dueLabel = useMemo(() => {
    if (todo.dueDate <= 0) return null;

    // 循环待办：如果当前 dueDate 已过期，展示自动推进后的下一次时间
    if (todo.isRecurring && todo.dueDate <= Date.now()) {
      const nextDue = computeNextDueDate(
        todo.dueDate,
        todo.recurrenceType,
        todo.recurrenceConfig,
      );
      if (nextDue > 0) {
        return formatDueDate(nextDue, locale === "en" ? "en" : "zh-CN");
      }
      return null;
    }
    return formatDueDate(todo.dueDate, locale === "en" ? "en" : "zh-CN");
  }, [todo.dueDate, todo.isRecurring, todo.recurrenceType, todo.recurrenceConfig, locale, now]);

  const recurrenceLabel = useMemo(
    () =>
      todo.isRecurring
        ? formatRecurrence(
            todo.recurrenceType,
            todo.recurrenceConfig,
            locale === "en" ? "en" : "zh-CN",
          )
        : null,
    [todo.isRecurring, todo.recurrenceType, todo.recurrenceConfig, locale],
  );

  // 进入编辑态时，光标定位到文本末尾
  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      data-tauri-no-drag
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e);
      }}
      className={
        "flex min-h-12 cursor-default items-center gap-1 px-2 touch-none sm:px-3 " +
        (sortable.isDragging ? "opacity-0" : "") +
        (!selected ? " hover:bg-[var(--ln-theme-surface-hover)]" : "")
      }
      style={{
        ...style,
        borderBottom: `1px solid var(--ln-theme-border-light)`,
        background: selected ? "var(--ln-theme-surface-active)" : "transparent",
      }}
    >
      {/* 循环待办：显示循环图标，不可点击完成 */}
      {todo.isRecurring ? (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center text-xs"
          title={locale === "zh-CN" ? "循环待办" : "Recurring"}
          style={{ color: accent }}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="1 4 1 10 7 10" />
            <polyline points="23 20 23 14 17 14" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
        </span>
      ) : (
        <button
          type="button"
          data-tauri-no-drag
          aria-pressed={todo.completed}
          aria-label={todo.completed ? t(locale, "menuUndone") : t(locale, "menuDone")}
          className={
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none transition " +
            "focus-visible:ring-2 focus-visible:ring-white/50"
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCompleted();
          }}
        >
          <span
            className={
              "flex h-[0.875rem] w-[0.875rem] items-center justify-center rounded-full border text-[0.5rem] font-semibold leading-none " +
              (todo.completed ? "border-transparent text-white" : "bg-transparent")
            }
            style={
              todo.completed
                ? { background: accent, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.2)" }
                : { borderColor: accent }
            }
          >
            {todo.completed ? "✓" : null}
          </span>
        </button>
      )}
      <button
        type="button"
        data-tauri-no-drag
        className="flex min-w-0 flex-1 items-center py-1 text-left cursor-pointer bg-transparent border-0"
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            data-tauri-no-drag
            className="min-h-10 w-0 flex-1 resize-none bg-transparent text-sm leading-snug outline-none ring-0"
            style={{ color: "var(--ln-theme-text)" }}
            rows={2}
            value={todo.text}
            onChange={(e) => onChangeText(e.target.value)}
            onBlur={onEndEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                (e.target as HTMLTextAreaElement).blur();
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                (e.target as HTMLTextAreaElement).blur();
              } else if (e.key === "Enter" && e.shiftKey) {
                e.stopPropagation(); // 允许默认换行，阻止冒泡到父按钮
              } else if (e.key === " ") {
                e.stopPropagation(); // 允许输入空格，阻止冒泡到父按钮
              }
            }}
          />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col py-0.5">
            <span
              className={
                "whitespace-pre-wrap text-sm leading-snug" +
                (todo.completed && !todo.isRecurring ? " opacity-50 line-through" : "")
              }
              style={{ color: "var(--ln-theme-text)" }}
            >
              {todo.text || (locale === "zh-CN" ? "（空）" : "(empty)")}
            </span>
            {(todo.pinned || dueLabel || recurrenceLabel) ? (
              <div className="mt-0.5 flex items-center gap-1.5">
                {todo.pinned ? (
                  <span className="text-xs text-sky-200/80">
                    ↑ {locale === "zh-CN" ? "置顶" : "Pinned"}
                  </span>
                ) : null}
                {recurrenceLabel ? (
                  <span className="text-xs text-emerald-300/80">
                    ↻ {recurrenceLabel}
                  </span>
                ) : null}
                {dueLabel ? (
                  <span className="text-xs"
                    style={{ color: todo.completed ? "var(--ln-theme-text-muted)" : "var(--ln-theme-text-secondary)" }}
                  >
                    {dueLabel}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </button>
    </div>
  );
}
