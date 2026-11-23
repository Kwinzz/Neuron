import { lazy, Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { isTauri, windowLabel } from "@/lib/ipc";

// Second window (global shortcut): only the quick prompt, none of the app shell.
const QuickLauncher = lazy(() => import("@/views/quick/QuickLauncher").then((m) => ({ default: m.QuickLauncher })));

export default function App() {
  if (!isTauri()) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-fg-muted">
        Neuron doit tourner dans Tauri — lancez <code className="mx-1 font-mono text-fg">npm run tauri dev</code>.
      </main>
    );
  }
  if (windowLabel() === "quick") {
    return (
      <Suspense fallback={null}>
        <QuickLauncher />
      </Suspense>
    );
  }
  return <AppShell />;
}
