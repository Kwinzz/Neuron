import { AlertCircle, History } from "lucide-react";
import type { RecentFile } from "@/bindings/RecentFile";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CardEmpty } from "./CardEmpty";
import { fileIcon } from "./fileIcon";
import { RelativeTime } from "./RelativeTime";

const MAX_FILES = 10;

function splitFilePath(filePath: string): { name: string; dir: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return { name: normalized, dir: "" };
  }
  return {
    name: normalized.slice(lastSlash + 1),
    dir: normalized.slice(0, lastSlash),
  };
}

interface RecentFilesCardProps {
  files: RecentFile[];
  loading: boolean;
  error?: string | null;
}

export function RecentFilesCard({ files, loading, error }: RecentFilesCardProps) {
  const visible = files.slice(0, MAX_FILES);

  return (
    <Card size="sm" className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Fichiers récents</span>
        </CardTitle>
        <CardDescription className="text-xs">Modifiés dans le dossier du projet</CardDescription>
        {files.length > 0 && (
          <CardAction>
            <Badge variant="outline" className="font-mono tabular-nums">
              {files.length}
            </Badge>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="min-w-0">
        {loading && visible.length === 0 ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error && visible.length === 0 ? (
          <CardEmpty icon={AlertCircle}>Liste des fichiers indisponible.</CardEmpty>
        ) : visible.length === 0 ? (
          <CardEmpty icon={History}>Aucun fichier modifié récemment</CardEmpty>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2">
            {visible.map((file) => {
              const { name, dir } = splitFilePath(file.path);
              const Icon = fileIcon(name);
              return (
                <li
                  key={file.path}
                  title={file.path}
                  className="flex min-w-0 items-center gap-2.5"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">{name}</span>
                    {dir && (
                      <span className="truncate font-mono text-xs text-muted-foreground">{dir}</span>
                    )}
                  </div>
                  <RelativeTime
                    ts={file.modifiedAt}
                    className="shrink-0 text-xs text-muted-foreground"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
