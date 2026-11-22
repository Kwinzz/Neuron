import { cn } from "cn";
import { AlertCircle, Check, GitBranch, GitCommitHorizontal, Info } from "lucide-react";
import type { GitSnapshot } from "@/bindings/GitSnapshot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CardEmpty } from "./CardEmpty";
import { CardSectionLabel } from "./CardSectionLabel";

const MAX_CHANGED = 10;

const STATUS_LEGEND: ReadonlyArray<{ code: string; label: string; toneClass: string }> = [
  { code: "M", label: "Modifié", toneClass: "text-warn" },
  { code: "A", label: "Ajouté", toneClass: "text-ok" },
  { code: "D", label: "Supprimé", toneClass: "text-destructive" },
  { code: "R", label: "Renommé", toneClass: "text-live" },
  { code: "U", label: "Non suivi", toneClass: "text-ok" },
  { code: "!", label: "Conflit", toneClass: "text-destructive" },
];

interface ParsedChange {
  letter: string;
  label: string;
  toneClass: string;
  path: string;
}

function parsePorcelainLine(line: string): ParsedChange {
  const xy = line.slice(0, 2);
  const rawPath = line.slice(3);
  const arrowIndex = rawPath.indexOf(" -> ");
  const path = arrowIndex !== -1 ? rawPath.slice(arrowIndex + 4) : rawPath;

  if (xy === "UU" || xy === "AA" || xy === "DD" || xy.includes("U")) {
    return { letter: "!", label: "Conflit", toneClass: "text-destructive", path };
  }

  if (xy === "??") {
    return { letter: "U", label: "Non suivi", toneClass: "text-ok", path };
  }

  if (xy.includes("D")) {
    return { letter: "D", label: "Supprimé", toneClass: "text-destructive", path };
  }

  if (xy.includes("R")) {
    return { letter: "R", label: "Renommé", toneClass: "text-live", path };
  }

  if (xy.includes("A")) {
    return { letter: "A", label: "Ajouté", toneClass: "text-ok", path };
  }

  if (xy.includes("M")) {
    return { letter: "M", label: "Modifié", toneClass: "text-warn", path };
  }

  if (xy.includes("C")) {
    return { letter: "C", label: "Copié", toneClass: "text-live", path };
  }

  const first = xy.trim().charAt(0) || "?";
  return { letter: first, label: "Autre", toneClass: "text-muted-foreground", path };
}

function splitFilePath(filePath: string): { dir: string; name: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dir: "", name: normalized };
  }
  return {
    dir: normalized.slice(0, lastSlash),
    name: normalized.slice(lastSlash + 1),
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
          <>
            <CardDescription className="truncate font-mono text-xs">
              {git.branch ?? "HEAD détachée"}
            </CardDescription>
            <CardAction>
              <Badge variant="outline" className="font-mono tabular-nums">
                {git.changed.length}
              </Badge>
            </CardAction>
          </>
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
          <CardEmpty icon={AlertCircle}>État git indisponible.</CardEmpty>
        ) : !git ? (
          <CardEmpty icon={GitBranch}>Ce dossier n'est pas un dépôt git.</CardEmpty>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <CardSectionLabel
                right={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Légende des statuts"
                        className="size-5 text-muted-foreground hover:text-foreground"
                      >
                        <Info className="size-3.5" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent align="end" className="p-2.5">
                      <ul className="flex flex-col gap-1">
                        {STATUS_LEGEND.map((item) => (
                          <li key={item.code} className="flex items-center gap-2">
                            <span
                              className={cn(
                                "inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-background font-mono text-[10px] font-semibold",
                                item.toneClass,
                              )}
                            >
                              {item.code}
                            </span>
                            <span>{item.label}</span>
                          </li>
                        ))}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                }
              >
                Modifications
              </CardSectionLabel>

              {git.changed.length === 0 ? (
                <CardEmpty icon={Check} tone="ok">
                  Arbre de travail propre
                </CardEmpty>
              ) : (
                <>
                  <ul className="flex min-w-0 flex-col gap-1.5">
                    {visibleChanged.map((line, index) => {
                      const { letter, label, toneClass, path } = parsePorcelainLine(line);
                      const { dir, name } = splitFilePath(path);
                      return (
                        <li key={`${line}-${index}`} className="flex min-w-0 items-center gap-2">
                          <span
                            role="img"
                            title={label}
                            aria-label={label}
                            className={cn(
                              "inline-flex size-5 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px] font-semibold",
                              toneClass,
                            )}
                          >
                            {letter}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
                            {dir && <span className="text-muted-foreground">{dir}/</span>}
                            <span className="text-foreground">{name}</span>
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
              <CardSectionLabel
                right={
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {git.recentCommits.length}
                  </span>
                }
              >
                Derniers commits
              </CardSectionLabel>

              {git.recentCommits.length === 0 ? (
                <CardEmpty icon={GitCommitHorizontal}>Aucun commit</CardEmpty>
              ) : (
                <ul className="flex min-w-0 flex-col gap-1.5">
                  {git.recentCommits.map((line, index) => {
                    const { hash, message } = parseCommitLine(line);
                    return (
                      <li key={`${hash}-${index}`} className="flex min-w-0 items-center gap-2 text-xs">
                        <span className="w-[7ch] shrink-0 font-mono text-muted-foreground">
                          {hash}
                        </span>
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
