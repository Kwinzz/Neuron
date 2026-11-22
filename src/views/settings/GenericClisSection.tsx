import { useState } from "react";
import { Plus, SquareTerminal } from "lucide-react";
import type { AppSettings } from "@/bindings/AppSettings";
import type { GenericCliProfile } from "@/bindings/GenericCliProfile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ipc, ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useModels } from "@/stores/models";
import { useSettings } from "@/stores/settings";
import { toast } from "@/stores/toast";
import { CardEmpty } from "@/views/project/CardEmpty";
import { GenericCliDeleteDialog } from "./GenericCliDeleteDialog";
import { GenericCliEditor } from "./GenericCliEditor";
import { GenericCliRow, type ProfileTestState } from "./GenericCliRow";

type EditorMode = { kind: "new" } | { kind: "edit"; id: string } | null;

interface GenericClisSectionProps {
  settings: AppSettings;
}

export function GenericClisSection({ settings }: GenericClisSectionProps) {
  const profiles = settings.genericClis;
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [tests, setTests] = useState<Record<string, ProfileTestState>>({});
  const [deleteTarget, setDeleteTarget] = useState<GenericCliProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleTestProfile = async (profile: GenericCliProfile) => {
    if (!isTauri()) return;
    setTests((prev) => ({
      ...prev,
      [profile.id]: { pending: true, result: null, error: null },
    }));
    try {
      const result = await ipc.testGenericCli(profile);
      setTests((prev) => ({
        ...prev,
        [profile.id]: { pending: false, result, error: null },
      }));
    } catch (err: unknown) {
      setTests((prev) => ({
        ...prev,
        [profile.id]: { pending: false, result: null, error: ipcErrorMessage(err) },
      }));
    }
  };

  const handleDismissTest = (id: string) => {
    setTests((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const base = useSettings.getState().settings ?? settings;
      const nextClis = base.genericClis.filter((item) => item.id !== deleteTarget.id);
      await useSettings.getState().save({ ...base, genericClis: nextClis });
      toast({ tone: "ok", title: "CLI supprimé" });
      void useModels.getState().load(true);
      handleDismissTest(deleteTarget.id);
      if (editorMode?.kind === "edit" && editorMode.id === deleteTarget.id) {
        setEditorMode(null);
      }
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: "Impossible de supprimer le CLI",
        description: ipcErrorMessage(err),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SquareTerminal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>CLI génériques</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Un processus par message, sans mémoire entre les messages ni demande
            d&apos;autorisation. Utilisable comme modèle dans « Nouveau chat ».
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              size="sm"
              disabled={editorMode?.kind === "new"}
              onClick={() => setEditorMode({ kind: "new" })}
            >
              <Plus className="size-3.5" aria-hidden />
              <span>Ajouter un CLI</span>
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="flex min-w-0 flex-col gap-3">
          {editorMode?.kind === "new" && (
            <GenericCliEditor
              key="new"
              settings={settings}
              editingProfile={null}
              editingIndex={null}
              onCancel={() => setEditorMode(null)}
              onSaved={() => setEditorMode(null)}
            />
          )}

          {profiles.length === 0 && editorMode === null ? (
            <CardEmpty icon={SquareTerminal}>
              Aucun CLI générique. Ajoute Ollama, Aider, Gemini CLI… pour les utiliser
              comme modèle.
            </CardEmpty>
          ) : (
            <div className="flex min-w-0 flex-col gap-2.5">
              {profiles.map((profile, index) =>
                editorMode?.kind === "edit" && editorMode.id === profile.id ? (
                  <GenericCliEditor
                    key={profile.id}
                    settings={settings}
                    editingProfile={profile}
                    editingIndex={index}
                    onCancel={() => setEditorMode(null)}
                    onSaved={() => setEditorMode(null)}
                  />
                ) : (
                  <GenericCliRow
                    key={profile.id}
                    profile={profile}
                    testState={tests[profile.id]}
                    onEdit={() => setEditorMode({ kind: "edit", id: profile.id })}
                    onTest={() => void handleTestProfile(profile)}
                    onDismissTest={() => handleDismissTest(profile.id)}
                    onDelete={() => setDeleteTarget(profile)}
                  />
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <GenericCliDeleteDialog
        profile={deleteTarget}
        pending={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </>
  );
}
