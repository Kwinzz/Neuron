import { cn } from "cn";
import { Check, GitBranch, GitCommitHorizontal } from "lucide-react";
import type { GitSnapshot } from "@/bindings/GitSnapshot";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const MAX_CHANGED = 10;

interface ParsedChange {
  displayStatus: string;
  statusTitle: string;
  toneClass: string;
  path: string;
}

function parsePorcelainLine(line: string): ParsedChange {
  const rawStatus = line.slice(0, 2).trim();
  const path = line.slice(3);

  if (rawStatus === "??") {
    return {
      displayStatus: "U",
      statusTitle: "Non suivi",
      toneClass: "text-ok",
      path,
    };
  }

  if (rawStatus.includes("D")) {
    return {
      displayStatus: rawStatus,
      statusTitle: "Supprimé",
      toneClass: "text-destructive",
      path,
    };
  }

  if (rawStatus.includes("M")) {
    return {
      displayStatus: rawStatus,
      statusTitle: "Modifié",
      toneClass: "text-warn",
      path,
    };
  }

  if (rawStatus.includes("A")) {
    return {
      displayStatus: rawStatus,
      statusTitle: "Ajouté",
      toneClass: "text-ok",
      path,
    };
  }

  return {
    displayStatus: rawStatus || "?",
    statusTitle: rawStatus || "Statut inconnu",
    toneClass: "text-muted-foreground",
    path,
  };
}

function parseCommitLine(line: string): { hash: string; message: string } {
  const spaceIndex = line.indexOf(" ");
  if (spaceIndex === -1) {
    return { hash: line.slice(0, 7), message: "" };
  }
  return {
    hash: line.slice(0, spaceIndex).slice(0, 7),
    message: line.slice(spaceIndex + 1),
  };
}

interface GitCardProps {
  git: GitSnapshot | null;
  loading: boolean;
  error?: string | null;
}

export function GitCard({ git, loading, error }: GitCardProps) {
  const visibleChanged = git ? git.changed.slice(0, MAX_CHANGED) : [];
  const remainingCount = git ? Math.max(0, git.changed.length - MAX_CHANGED) : 0;

  return (
    <Card size="sm" className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Git</span>
        </CardTitle>
        {git && (
          <CardDescription className="truncate font-mono text-xs">
            {git.branch ?? "HEAD détachée"}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="min-w-0">
        {loading && !git ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : error && !git ? (
          <p className="text-xs text-muted-foreground">État git indisponible.</p>
        ) : !git ? (
          <p className="text-xs text-muted-foreground">Ce dossier n'est pas un dépôt git.</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-muted-foreground">Fichiers modifiés</span>
                <span className="font-mono tabular-nums text-muted-foreground">{git.changed.length}</span>
              </div>

              {git.changed.length === 0 ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Check className="size-3.5 shrink-0 text-ok" aria-hidden />
                  <span>Arbre de travail propre</span>
                </p>
              ) : (
                <>
                  <ul className="flex min-w-0 flex-col gap-1">
                    {visibleChanged.map((line, index) => {
                      const { displayStatus, statusTitle, toneClass, path } = parsePorcelainLine(line);
                      return (
                        <li
                          key={`${line}-${index}`}
                          className="flex min-w-0 items-center gap-2 font-mono text-xs"
                        >
                          <span
                            className={cn("w-4 shrink-0 text-center font-medium", toneClass)}
                            title={statusTitle}
                          >
                            {displayStatus}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-foreground" title={path}>
                            {path}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {remainingCount > 0 && (
                    <p className="font-mono text-xs tabular-nums text-muted-foreground">
                      + {remainingCount} {remainingCount === 1 ? "autre" : "autres"}
                    </p>
                  )}
                </>
              )}
            </div>

            <Separator />

            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Derniers commits</span>
              {git.recentCommits.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucun commit</p>
              ) : (
                <ul className="flex min-w-0 flex-col gap-1.5">
                  {git.recentCommits.map((line, index) => {
                    const { hash, message } = parseCommitLine(line);
                    return (
                      <li key={`${hash}-${index}`} className="flex min-w-0 items-center gap-2 text-xs">
                        <GitCommitHorizontal
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="w-[7ch] shrink-0 font-mono text-muted-foreground">{hash}</span>
                        <span className="min-w-0 flex-1 truncate text-foreground" title={message}>
                          {message}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
