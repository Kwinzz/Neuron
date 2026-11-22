import { Bot, FileText, UserRound } from "lucide-react";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { describeSource } from "./categories";

interface MemorySourceProps {
  source: string;
}

export function MemorySource({ source }: MemorySourceProps) {
  const described = describeSource(source);

  if (described.kind === "user") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <UserRound className="size-3 shrink-0" aria-hidden />
        <span className="truncate">Ajouté par toi</span>
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

  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {described.agent !== null ? (
        <AgentLogo agent={described.agent} size={12} className="shrink-0" />
      ) : (
        <Bot className="size-3 shrink-0" aria-hidden />
      )}
      <span className="truncate">Enregistré par {described.label}</span>
    </span>
  );
}
