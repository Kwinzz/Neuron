import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { AlertTriangle, FolderOpen, Sparkles, X } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import { Button } from "@/components/legacy/Button";
import { IconBox } from "@/components/ui/IconBox";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { AGENTS } from "@/lib/agents";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

const AGENT_CHOICES: { agent: AgentKind; available: boolean }[] = [
  { agent: "claude_code", available: true },
  { agent: "antigravity", available: false },
  { agent: "codex", available: false },
  { agent: "generic", available: false },
];

const MODELS = [
  { value: "", label: "Par défaut" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
] as const;

const PERMISSION_MODES = [
  { value: "manual", label: "Demander", hint: "Chaque action sensible attend ton approbation." },
  { value: "acceptEdits", label: "Éditions auto", hint: "Modifs de fichiers acceptées, commandes à approuver." },
  { value: "plan", label: "Plan", hint: "Lecture seule : l'agent propose un plan." },
  { value: "bypassPermissions", label: "Tout autoriser", hint: "Aucune confirmation. À réserver aux dossiers jetables." },
] as const;

export function NewThreadDialog() {
  const open = useUi((s) => s.newThreadOpen);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const close = () => useUi.getState().setNewThreadOpen(false);
  const [agent, setAgent] = useState<AgentKind>("claude_code");
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState(false);
  const [mode, setMode] = useState<string>("manual");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ipc
      .defaultCwd()
      .then((dir) => setCwd((current) => current || dir))
      .catch(() => undefined);
    promptRef.current?.focus();
  }, []);

  const browse = async () => {
    try {
      const picked = await ipc.pickDirectory(cwd || undefined);
      if (picked) setCwd(picked);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!cwd.trim()) {
      setError("Choisis un dossier de travail.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const thread = await ipc.createThread({
        agent,
        cwd: cwd.trim(),
        model: model.trim() || null,
        permissionMode: mode,
        title: null,
        projectId: null,
        prompt: prompt.trim() || null,
      });
      useLive.getState().hydrate([thread]);
      useUi.getState().focusThread(thread.id);
      useDashboard.getState().scheduleRefresh();
      close();
    } catch (err) {
      setError(ipcErrorMessage(err));
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div
      className="fade-in fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-bg/60 py-[8vh]"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-thread-title"
        onSubmit={submit}
        onKeyDown={onKeyDown}
        className="glass-overlay pop-in flex w-[640px] max-w-[calc(100vw-32px)] flex-col gap-5 p-6 shadow-2xl shadow-black/60"
      >
        <header className="flex items-center gap-3">
          <IconBox tone="brand" size={36}>
            <Sparkles size={17} />
          </IconBox>
          <div className="flex-1">
            <h2 id="new-thread-title" className="text-lg font-bold text-fg">
              Nouveau thread
            </h2>
            <p className="text-sm text-fg-muted">Lance un agent dans un dossier de travail.</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Fermer"
            className="rounded-md p-2 text-fg-muted transition-colors duration-fast hover:bg-surface hover:text-fg"
          >
            <X size={16} />
          </button>
        </header>

        <Field label="Agent">
          <div className="grid grid-cols-4 gap-2">
            {AGENT_CHOICES.map(({ agent: a, available }) => (
              <button
                key={a}
                type="button"
                disabled={!available}
                onClick={() => setAgent(a)}
                aria-pressed={agent === a}
                className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left text-sm font-bold transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-45 ${
                  agent === a ? "border-brand bg-brand/20 text-fg" : "border-line-strong bg-surface/60 text-fg-muted hover:text-fg"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`size-2 rounded-[3px] ${AGENTS[a].bg}`} aria-hidden />
                  {AGENTS[a].short}
                </span>
                {!available && <span className="text-[10px] font-bold uppercase tracking-wide text-fg-subtle">Bientôt</span>}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Dossier de travail">
          <div className="flex gap-2">
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
              placeholder="C:\chemin\vers\le\projet"
              className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-bg-sunken px-3 font-mono text-[13px] text-fg outline-none transition-colors duration-fast focus:border-hl"
            />
            <Button type="button" variant="subtle" onClick={() => void browse()}>
              <FolderOpen size={15} />
              Parcourir
            </Button>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-5">
          <Field label="Modèle">
            <div className="flex flex-wrap gap-1.5">
              {MODELS.map((m) => (
                <Chip
                  key={m.value || "default"}
                  active={!customModel && model === m.value}
                  onClick={() => {
                    setCustomModel(false);
                    setModel(m.value);
                  }}
                >
                  {m.label}
                </Chip>
              ))}
              <Chip active={customModel} onClick={() => setCustomModel(true)}>
                Autre…
              </Chip>
            </div>
            {customModel && (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="ex. claude-opus-5-5"
                spellCheck={false}
                className="mt-2 h-9 w-full rounded-md border border-line-strong bg-bg-sunken px-3 font-mono text-[13px] text-fg outline-none focus:border-hl"
              />
            )}
          </Field>

          <Field label="Permissions">
            <div className="flex flex-col gap-1.5">
              {PERMISSION_MODES.map((p) => (
                <label
                  key={p.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-1.5 transition-colors duration-fast ${
                    mode === p.value ? "bg-surface" : "hover:bg-surface/50"
                  }`}
                  title={p.hint}
                >
                  <input
                    type="radio"
                    name="permission-mode"
                    value={p.value}
                    checked={mode === p.value}
                    onChange={() => setMode(p.value)}
                    className="mt-1 accent-[var(--color-brand)]"
                  />
                  <span className="min-w-0">
                    <span className={`block text-sm font-bold ${p.value === "bypassPermissions" ? "text-warn" : "text-fg"}`}>
                      {p.label}
                    </span>
                    {mode === p.value && <span className="block text-xs text-fg-muted">{p.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Premier message (optionnel)">
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Que doit faire l'agent ?"
            className="w-full resize-y rounded-md border border-line-strong bg-bg-sunken px-3 py-2.5 text-sm text-fg outline-none transition-colors duration-fast placeholder:text-fg-subtle focus:border-hl"
          />
        </Field>

        {error && (
          <p className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <footer className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-fg-muted">
            <Kbd>{MOD_LABEL}</Kbd>
            <Kbd>↵</Kbd> créer
          </span>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Lancement…" : prompt.trim() ? "Créer et lancer" : "Créer le thread"}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold uppercase tracking-wide text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 rounded-md px-3 text-xs font-bold transition-colors duration-fast ${
        active ? "bg-brand text-brand-fg" : "bg-surface text-fg-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
