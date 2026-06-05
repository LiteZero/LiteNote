import { useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WidgetShell } from "@/components/widget/WidgetShell";
import { useAppInit } from "@/hooks/useAppInit";
import { startReminderPoll } from "@/lib/reminderPoll";
import { useSettingsStore } from "@/stores/settingsStore";

function App() {
  useAppInit(true);

  const initialized = useSettingsStore((s) => s.initialized);
  const theme = useSettingsStore((s) => s.theme);

  // 绑定 data-theme 到 html 根节点
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (initialized) {
      startReminderPoll();
    }
  }, [initialized]);

  return (
    <ErrorBoundary>
      <WidgetShell />
    </ErrorBoundary>
  );
}

export default App;
