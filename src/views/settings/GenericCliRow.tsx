import { Loader2, Pencil, Play, Trash2 } from "lucide-react";
import type { GenericCliProfile } from "@/bindings/GenericCliProfile";
import type { GenericCliTest } from "@/bindings/GenericCliTest";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isTauri } from "@/lib/ipc";
import { GenericCliCommandPreview } from "./GenericCliCommandPreview";
import { GenericCliTestResult } from "./GenericCliTestResult";

export interface ProfileTestState {
  pending: boolean;
  result: GenericCliTest | null;
  error: string | null;
}

interface GenericCliRowProps {
  profile: GenericCliProfile;
  testState?: ProfileTestState;
  onEdit: () => void;
  onTest: () => void;
  onDismissTest: () => void;
  onDelete: () => void;
}

export function GenericCliRow({
  profile,
  testState,
  onEdit,
  onTest,
  onDismissTest,
  onDelete,
}: GenericCliRowProps) {
  const tauri = isTauri();
  const pending = testState?.pending ?? false;

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-lg border p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{profile.name}</span>
            {profile.pty && <Badge variant="outline">PTY</Badge>}
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {profile.id}
            </span>
          </div>
          <GenericCliCommandPreview command={profile.command} args={profile.args} />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={onEdit}>
            <Pencil aria-hidden />
            <span>Modifier</span>
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending || !tauri}
            title={!tauri ? "Disponible dans l'application" : undefined}
            onClick={onTest}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Play aria-hidden />
            )}
            <span>Tester</span>
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
            <span>Supprimer</span>
          </Button>
        </div>
      </div>

      {testState && (testState.result !== null || testState.error !== null) && (
        <GenericCliTestResult
          result={testState.result}
          error={testState.error}
          onDismiss={onDismissTest}
        />
      )}
    </div>
  );
}
