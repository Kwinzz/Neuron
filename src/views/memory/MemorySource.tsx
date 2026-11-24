import { Bot, Download, FileText, UserRound } from "lucide-react";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { describeSource } from "./categories";
import { t } from "@/i18n";

interface MemorySourceProps {
  source: string;
}

export function MemorySource({ source }: MemorySourceProps) {
  const described = describeSource(source);

  if (described.kind === "user") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <UserRound className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{t("memory.addedByYou")}</span>
      </span>
    );
  }

  if (described.kind === "file") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <FileText className="size-3 shrink-0" aria-hidden />
        <span className="truncate font-mono">memory.md</span>
      </span>
    );
  }

  if (described.kind === "import") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <Download className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {/* Unknown / « Autre » origins just say « Importé ». */}
          {described.label === null
            ? t("memory.imported")
            : t("memory.importedFrom", { source: described.label })}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {described.agent !== null ? (
        <AgentLogo agent={described.agent} size={12} className="shrink-0" />
      ) : (
        <Bot className="size-3 shrink-0" aria-hidden />
      )}
      <span className="truncate">{t("memory.savedBy", { agent: described.label })}</span>
    </span>
  );
}
