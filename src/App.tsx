import { useEffect, useState, type ReactNode } from "react";
import { Database, Cpu, FolderTree, Zap } from "lucide-react";
import type { AppInfo } from "@/bindings/AppInfo";
import { ipc, ipcErrorMessage, isTauri } from "@/lib/ipc";

type BootState =
  | { status: "loading" }
  | { status: "ready"; info: AppInfo }
  | { status: "error"; message: string };

/**
 * Phase 0 boot screen: proves the full chain (React → IPC → Rust → SQLite) works.
 * Replaced by the app shell in Phase 1.
 */
export default function App() {
  const [boot, setBoot] = useState<BootState>({ status: "loading" });

  useEffect(() => {
    if (!isTauri()) {
      setBoot({ status: "error", message: "Hors de Tauri — lancez `npm run tauri dev`." });
      return;
    }
    let cancelled = false;
    ipc
      .appInfo()
      .then((info) => !cancelled && setBoot({ status: "ready", info }))
      .catch((err: unknown) => !cancelled && setBoot({ status: "error", message: ipcErrorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex h-full items-center justify-center bg-bg p-8">
      <section className="w-full max-w-lg rounded-lg border border-line bg-surface">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="size-2 rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)]" />
          <h1 className="text-sm font-medium tracking-tight text-fg">Neuron</h1>
          <span className="ml-auto font-mono text-xs text-fg-subtle tabular-nums">
            {boot.status === "ready" ? `v${boot.info.version}` : "—"}
          </span>
        </header>

        <div className="px-5 py-4">
          {boot.status === "loading" && <p className="text-fg-muted">Initialisation…</p>}
          {boot.status === "error" && <p className="text-danger">{boot.message}</p>}
          {boot.status === "ready" && <InfoGrid info={boot.info} />}
        </div>
      </section>
    </main>
  );
}

function InfoGrid({ info }: { info: AppInfo }) {
  const schemaOk = info.schemaVersion === info.latestSchemaVersion;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-xs">
      <Row icon={<Zap size={14} />} label="Démarrage">
        <span className="font-mono tabular-nums text-accent">{info.setupMs} ms</span>
        <span className="text-fg-subtle"> · DB </span>
        <span className="font-mono tabular-nums text-fg-muted">{(info.dbOpenUs / 1000).toFixed(1)} ms</span>
      </Row>
      <Row icon={<Database size={14} />} label="Schéma">
        <span className={`font-mono tabular-nums ${schemaOk ? "text-ok" : "text-warn"}`}>
          v{info.schemaVersion}/{info.latestSchemaVersion}
        </span>
        <span className="text-fg-subtle"> · {info.tableCount} tables</span>
      </Row>
      <Row icon={<Cpu size={14} />} label="Base">
        <Path value={info.dbPath} />
      </Row>
      <Row icon={<FolderTree size={14} />} label="Mémoire">
        <Path value={info.neuronHome} />
      </Row>
    </dl>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex items-center gap-2 text-fg-muted">
        <span className="text-fg-subtle">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Path({ value }: { value: string }) {
  return (
    <span className="block truncate font-mono text-fg-muted" title={value}>
      {value}
    </span>
  );
}
