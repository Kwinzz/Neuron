import { useCallback, useEffect, useMemo, useState } from "react";
import { DraftContextPreview } from "@/components/context/DraftContextPreview";
import { FolderGit2, FolderOpen, MessageSquarePlus } from "lucide-react";
import { ChatSettingsBar } from "@/components/chat/ChatSettingsBar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import type { ChatSettings } from "@/lib/models";
import { useDashboard } from "@/stores/dashboard";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";
import { Composer } from "./Composer";

const DEFAULTS_KEY = "neuron.chatDefaults";
const FALLBACK: ChatSettings = { agent: "claude_code", model: null, effort: null, permissionMode: "manual" };

function readDefaults(): ChatSettings {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    return raw ? { ...FALLBACK, ...(JSON.parse(raw) as Partial<ChatSettings>) } : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Empty chat: pick model / reasoning / permissions, type, and the chat is created on send. */
export function DraftChat({ projectId }: { projectId: string | null }) {
  const project = useNav((s) => (projectId ? s.projects.find((p) => p.id === projectId) : undefined));
  const [settings, setSettings] = useState<ChatSettings>(readDefaults);
  const [cwd, setCwd] = useState<string>("");

  useEffect(() => {
    if (projectId) return;
    ipc
      .defaultCwd()
      .then((dir) => setCwd((current) => current || dir))
      .catch(() => undefined);
  }, [projectId]);

  const onSettings = useCallback((next: ChatSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(DEFAULTS_KEY, JSON.stringify(next));
    } catch {
      /* not persisted */
    }
  }, []);

  const browse = useCallback(async () => {
    try {
      const picked = await ipc.pickDirectory(cwd || undefined);
      if (picked) setCwd(picked);
    } catch (err) {
      toast({ tone: "danger", title: "Dossier inaccessible", description: ipcErrorMessage(err) });
    }
  }, [cwd]);

  const submit = useCallback(
    async (text: string) => {
      try {
        const chat = await ipc.createThread({
          agent: settings.agent,
          cwd: projectId ? null : cwd || null,
          model: settings.model,
          effort: settings.effort,
          permissionMode: settings.permissionMode,
          title: null,
          projectId,
          prompt: text,
        });
        useLive.getState().hydrate([chat]);
        useUi.getState().focusThread(chat.id);
        void useNav.getState().load();
        useDashboard.getState().scheduleRefresh();
        return true;
      } catch (err) {
        toast({ tone: "danger", title: "Impossible de démarrer le chat", description: ipcErrorMessage(err) });
        return false;
      }
    },
    [cwd, projectId, settings],
  );

  const toolbar = useMemo(
    () => (
      <>
        <ChatSettingsBar value={settings} onChange={onSettings} />
        {!projectId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 max-w-48 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => void browse()}
              >
                <FolderOpen className="size-3.5" />
                <span className="truncate">{cwd ? folderName(cwd) : "Dossier…"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="font-mono">{cwd || "Choisir le dossier de travail"}</TooltipContent>
          </Tooltip>
        )}
      </>
    ),
    [browse, cwd, onSettings, projectId, settings],
  );

  return (
    <div className="flex min-h-full flex-col px-4 md:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border bg-card animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy">
          <MessageSquarePlus className="size-5 text-muted-foreground" />
        </div>
        <h2
          className="text-2xl font-semibold tracking-tight animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy"
          style={{ animationDelay: "40ms" }}
        >
          Nouveau chat
        </h2>
        <p
          className="max-w-md text-sm text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-snappy"
          style={{ animationDelay: "80ms" }}
        >
          {project ? (
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2 className="size-4" />
              Dans le projet <span className="font-medium text-foreground">{project.name}</span>
            </span>
          ) : (
            "Choisis le modèle (Claude, Codex, Antigravity…) et le niveau de raisonnement, puis écris ton premier message."
          )}
        </p>
        {projectId && <DraftContextPreview projectId={projectId} />}
      </div>
      <Composer
        threadId={null}
        projectId={projectId}
        submit={submit}
        toolbar={toolbar}
        placeholder="Que doit faire l'agent ? (Entrée pour démarrer le chat)"
        active={false}
        onSent={noop}
        showPill={false}
        onPillClick={noop}
      />
    </div>
  );
}

function noop() {}
