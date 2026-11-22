import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";
import { AlertCircle, FolderOpen } from "lucide-react";
import type { AgentKind } from "@/bindings/AgentKind";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MOD_LABEL } from "@/components/ui/Kbd";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  { value: "default", label: "Par défaut" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
  { value: "custom", label: "Autre…" },
] as const;

const PERMISSION_MODES = [
  { value: "manual", label: "Demander", hint: "Chaque action sensible attend ton approbation." },
  { value: "acceptEdits", label: "Éditions auto", hint: "Modifs de fichiers acceptées, commandes à approuver." },
  { value: "plan", label: "Plan", hint: "Lecture seule : l'agent propose un plan." },
  { value: "bypassPermissions", label: "Tout autoriser", hint: "Aucune confirmation — dossiers jetables uniquement." },
] as const;

export function NewThreadDialog() {
  const open = useUi((s) => s.newThreadOpen);
  const setOpen = useUi((s) => s.setNewThreadOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">{open && <NewThreadForm />}</DialogContent>
    </Dialog>
  );
}

function NewThreadForm() {
  const close = () => useUi.getState().setNewThreadOpen(false);
  const [agent, setAgent] = useState<AgentKind>("claude_code");
  const [cwd, setCwd] = useState("");
  const [modelChoice, setModelChoice] = useState<string>("default");
  const [customModel, setCustomModel] = useState("");
  const [mode, setMode] = useState<string>("manual");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipc
      .defaultCwd()
      .then((dir) => setCwd((current) => current || dir))
      .catch(() => undefined);
  }, []);

  const model = modelChoice === "default" ? "" : modelChoice === "custom" ? customModel : modelChoice;

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
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle>Nouveau thread</DialogTitle>
        <DialogDescription>Lance un agent IA dans un dossier de travail.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label>Agent</Label>
        <ToggleGroup type="single" variant="outline" value={agent} onValueChange={(v) => v && setAgent(v as AgentKind)} className="w-full">
          {AGENT_CHOICES.map(({ agent: a, available }) => (
            <ToggleGroupItem key={a} value={a} disabled={!available} className="flex-1 gap-2" title={available ? undefined : "Bientôt"}>
              <span className="size-2 rounded-[2px]" style={{ background: AGENTS[a].color }} aria-hidden />
              {AGENTS[a].short}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="thread-cwd">Dossier de travail</Label>
        <div className="flex gap-2">
          <Input
            id="thread-cwd"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            spellCheck={false}
            placeholder="C:\chemin\vers\le\projet"
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={() => void browse()}>
            <FolderOpen />
            Parcourir
          </Button>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label>Modèle</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={modelChoice}
            onValueChange={(v) => v && setModelChoice(v)}
            className="flex-wrap justify-start"
          >
            {MODELS.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value}>
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {modelChoice === "custom" && (
            <Input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="ex. claude-opus-5-5"
              spellCheck={false}
              className="font-mono text-xs"
            />
          )}
        </div>

        <div className="grid content-start gap-2">
          <Label>Permissions</Label>
          <RadioGroup value={mode} onValueChange={setMode} className="gap-2">
            {PERMISSION_MODES.map((p) => (
              <Label
                key={p.value}
                htmlFor={`perm-${p.value}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-muted/50"
              >
                <RadioGroupItem id={`perm-${p.value}`} value={p.value} className="mt-0.5" />
                <span className="grid gap-1">
                  <span className={p.value === "bypassPermissions" ? "font-medium text-warn" : "font-medium"}>{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.hint}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="thread-prompt">Premier message (optionnel)</Label>
        <Textarea
          id="thread-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Que doit faire l'agent ?"
          autoFocus
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter className="items-center sm:justify-between">
        <span className="hidden text-xs text-muted-foreground sm:block">{MOD_LABEL}+Entrée pour créer</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Lancement…" : prompt.trim() ? "Créer et lancer" : "Créer le thread"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
