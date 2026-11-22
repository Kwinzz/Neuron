import { CheckCircle2, X, XCircle } from "lucide-react";
import type { GenericCliTest } from "@/bindings/GenericCliTest";
import { Button } from "@/components/ui/button";
import { formatTestDuration } from "./genericCliFormat";

interface GenericCliTestResultProps {
  result: GenericCliTest | null;
  error: string | null;
  onDismiss: () => void;
}

export function GenericCliTestResult({
  result,
  error,
  onDismiss,
}: GenericCliTestResultProps) {
  if (!result && !error) return null;

  const ok = error === null && result !== null && result.ok;
  const durationMs = error === null && result !== null ? result.durationMs : null;
  const output = error ?? result?.output ?? "";

  return (
    <div
      role="status"
      className="flex min-w-0 flex-col gap-2 rounded-md border bg-card/60 p-2.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          {ok ? (
            <>
              <CheckCircle2 className="size-3.5 shrink-0 text-ok" aria-hidden />
              <span className="text-foreground">
                Réponse reçue en{" "}
                <span className="font-mono tabular-nums">
                  {formatTestDuration(durationMs ?? 0)}
                </span>
              </span>
            </>
          ) : (
            <>
              <XCircle className="size-3.5 shrink-0 text-destructive" aria-hidden />
              <span className="text-destructive">
                Échec du test
                {durationMs !== null && (
                  <>
                    {" "}
                    (
                    <span className="font-mono tabular-nums">
                      {formatTestDuration(durationMs)}
                    </span>
                    )
                  </>
                )}
              </span>
            </>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onDismiss}
          aria-label="Fermer le résultat du test"
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>

      <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-foreground">
        {output.trim().length > 0 ? output : "(aucune sortie)"}
      </pre>
    </div>
  );
}
