import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Info, Plug } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ipcErrorMessage } from "@/lib/ipc";
import { useMemory } from "@/stores/memory";
import { toast } from "@/stores/toast";
import { CardSectionLabel } from "@/views/project/CardSectionLabel";
import { t, type MessageKey } from "@/i18n";

/** Tool names are never translated; their descriptions are. */
const MCP_TOOLS: ReadonlyArray<{ name: string; description: MessageKey }> = [
  { name: "neuron_memory", description: "settings.toolMemory" },
  { name: "neuron_project_context", description: "settings.toolContext" },
];

export function AgentsMcpCard() {
  const info = useMemory((s) => s.info);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: t("settings.copyCommandFailed"),
        description: ipcErrorMessage(err),
      });
    }
  };

  return (
    <Card
      size="sm"
      className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("settings.mcpTitle")}</span>
        </CardTitle>
        <CardDescription>
          {t("settings.mcpDescription")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-3.5">
        {info && !info.mcpEnabled && (
          <Alert>
            <Info aria-hidden />
            <AlertTitle>{t("settings.mcpDisabled")}</AlertTitle>
          </Alert>
        )}

        <div className="flex min-w-0 flex-col gap-2">
          <CardSectionLabel>{t("settings.mcpTools")}</CardSectionLabel>
          <ul className="flex min-w-0 flex-col gap-2">
            {MCP_TOOLS.map((tool) => (
              <li key={tool.name} className="flex min-w-0 flex-col gap-0.5">
                <code className="truncate font-mono text-xs text-foreground">
                  {tool.name}
                </code>
                <span className="text-xs text-muted-foreground">
                  {t(tool.description)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Separator />

        <Collapsible className="flex min-w-0 flex-col gap-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="group -mx-2 w-fit justify-start gap-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90"
                aria-hidden
              />
              <span>{t("settings.mcpServerCommand")}</span>
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="min-w-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150">
            {info ? (
              <div className="flex min-w-0 items-start gap-2 rounded-lg border bg-muted/30 p-2.5">
                <code className="min-w-0 flex-1 font-mono text-xs wrap-anywhere text-foreground">
                  {info.mcpCommand}
                </code>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("settings.copyCommand")}
                      onClick={() => void handleCopyCommand(info.mcpCommand)}
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="text-ok" aria-hidden />
                      ) : (
                        <Copy aria-hidden />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copied ? t("common.copied") : t("common.copy")}</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <Skeleton className="h-10 w-full rounded-lg" />
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
