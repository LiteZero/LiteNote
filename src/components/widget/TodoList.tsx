import { useMemo, useState } from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Locale } from "@/i18n";
import { t } from "@/i18n";
import { sortTodos } from "@/lib/todoSort";
import type { TodoItem } from "@/types/todo";
import { TodoRow } from "./TodoRow";

function withCount(template: string, n: number): string {
  return template.replace(/\{n\}/g, String(n));
}

interface TodoListProps {
  locale: Locale;
  todos: TodoItem[];
  selectedId: string | null;
  editingId: string | null;
  emptyHint: string;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onEndEdit: () => void;
  onToggleCompleted: (id: string) => void;
}

export function TodoList({
  locale,
  todos,
  selectedId,
  editingId,
  emptyHint,
  onSelect,
  onContextMenu,
  onChangeText,
  onEndEdit,
  onToggleCompleted,
}: TodoListProps) {
  const [completedExpanded, setCompletedExpanded] = useState(false);

  const { activeSorted, completedSorted, activeIds } = useMemo(() => {
    const active = todos.filter((x) => !x.completed);
    const done = todos.filter((x) => x.completed);
    return {
      activeSorted: sortTodos(active),
      completedSorted: sortTodos(done),
      activeIds: active.map((x) => x.id),
    };
  }, [todos]);

  const emptyCenter =
    "flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-6 text-center text-sm";
const emptyStyle = { color: "var(--ln-theme-text-secondary)" } as React.CSSProperties;

  const renderRows = (list: TodoItem[]) =>
    list.map((todo) => (
      <TodoRow
        key={todo.id}
        todo={todo}
        locale={locale}
        selected={todo.id === selectedId}
        editing={todo.id === editingId}
        onSelect={() => onSelect(todo.id)}
        onContextMenu={(e) => onContextMenu(e, todo.id)}
        onChangeText={(text) => onChangeText(todo.id, text)}
        onEndEdit={onEndEdit}
        onToggleCompleted={() => onToggleCompleted(todo.id)}
      />
    ));

  if (todos.length === 0) {
    return (
      <div className={emptyCenter} style={emptyStyle}>
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeSorted.length === 0 ? (
          <div className={emptyCenter} style={emptyStyle}>
            {completedSorted.length > 0
              ? t(locale, "emptyNoActive")
              : emptyHint}
          </div>
        ) : (
          <SortableContext
            items={activeIds}
            strategy={verticalListSortingStrategy}
          >
            {renderRows(activeSorted)}
          </SortableContext>
        )}
      </div>

      {completedSorted.length > 0 ? (
        <div
          className="shrink-0"
          style={{ borderTop: `1px solid var(--ln-theme-border)`, background: "var(--ln-theme-surface)" }}
          data-tauri-no-drag
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--ln-theme-surface-hover)]"
            style={{ color: "var(--ln-theme-text)" }}
            aria-expanded={completedExpanded}
            onClick={() => setCompletedExpanded((v) => !v)}
          >
            <span>
              {withCount(
                t(locale, "completedSection"),
                completedSorted.length,
              )}
            </span>
            <span className="text-xs" style={{ color: "var(--ln-theme-text-secondary)" }} aria-hidden>
              {completedExpanded ? "▼" : "▶"}
            </span>
          </button>
          {completedExpanded ? (
            <div className="max-h-[min(40vh,12rem)] overflow-y-auto" style={{ borderTop: `1px solid var(--ln-theme-border-light)` }}>
              {renderRows(completedSorted)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
