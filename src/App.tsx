import { AppShell } from "@/components/shell/AppShell";
import { isTauri } from "@/lib/ipc";

export default function App() {
  if (!isTauri()) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-fg-muted">
        Neuron doit tourner dans Tauri — lancez <code className="mx-1 font-mono text-fg">npm run tauri dev</code>.
      </main>
    );
  }
  return <AppShell />;
}
