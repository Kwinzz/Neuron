import type { ReactNode } from "react";
import type { JsonValue } from "@/bindings/serde_json/JsonValue";
import { Badge } from "@/components/ui/badge";
import { DiffView } from "./DiffView";
import { OutputBlock } from "./OutputBlock";
import { arr, asObject, num, prettyJson, str } from "./json";
import { baseToolName } from "./toolMeta";
import { t } from "@/i18n";

interface ToolBodyProps {
  name: string;
  input: JsonValue;
  output: string | null;
  outputTone?: "default" | "danger";
}

function FileHeader({ path }: { path: string | null }) {
  if (!path) return null;
  return (
    <div className="truncate font-mono text-xs text-muted-foreground select-text" title={path}>
      {path}
    </div>
  );
}

function renderInput(name: string, input: JsonValue): ReactNode {
  const base = baseToolName(name);
  const obj = asObject(input);

  if (base === "Edit") {
    const oldStr = str(obj, "old_string");
    const newStr = str(obj, "new_string");
    if (oldStr !== null && newStr !== null) {
      return (
        <div className="flex flex-col gap-2">
          <FileHeader path={str(obj, "file_path")} />
          <DiffView oldText={oldStr} newText={newStr} />
        </div>
      );
    }
  }

  if (base === "MultiEdit") {
    const rawEdits = arr(obj, "edits");
    if (rawEdits && rawEdits.length > 0) {
      const pairs: Array<{ oldText: string; newText: string }> = [];
      for (const entry of rawEdits) {
        const editObj = asObject(entry);
        const oldStr = str(editObj, "old_string");
        const newStr = str(editObj, "new_string");
        if (oldStr !== null && newStr !== null) {
          pairs.push({ oldText: oldStr, newText: newStr });
        }
      }
      if (pairs.length > 0) {
        return (
          <div className="flex flex-col gap-2">
            <FileHeader path={str(obj, "file_path")} />
            {pairs.map((p, idx) => (
              <DiffView key={idx} oldText={p.oldText} newText={p.newText} />
            ))}
          </div>
        );
      }
    }
  }

  if (base === "Write") {
    const content = str(obj, "content");
    if (content !== null) {
      return (
        <div className="flex flex-col gap-2">
          <FileHeader path={str(obj, "file_path")} />
          <OutputBlock text={content} maxLines={40} />
        </div>
      );
    }
  }

  if (base === "Bash" || base === "PowerShell") {
    const command = str(obj, "command");
    if (command !== null) {
      const description = str(obj, "description");
      return (
        <div className="flex flex-col gap-1.5">
          {description && <p className="wrap-anywhere text-xs text-muted-foreground">{description}</p>}
          <pre className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap break-all select-text">
            <span className="select-none text-muted-foreground">$ </span>
            {command}
          </pre>
        </div>
      );
    }
  }

  if (base === "Read") {
    const filePath = str(obj, "file_path");
    if (filePath !== null) {
      const offset = num(obj, "offset");
      const limit = num(obj, "limit");
      return (
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="min-w-0 wrap-anywhere text-foreground select-text">{filePath}</span>
          {offset !== null && (
            <Badge variant="secondary" className="h-auto max-w-full font-mono whitespace-normal wrap-anywhere text-left">
              offset {offset}
            </Badge>
          )}
          {limit !== null && (
            <Badge variant="secondary" className="h-auto max-w-full font-mono whitespace-normal wrap-anywhere text-left">
              limit {limit}
            </Badge>
          )}
        </div>
      );
    }
  }

  if (base === "Glob") {
    const pattern = str(obj, "pattern");
    if (pattern !== null) {
      const path = str(obj, "path");
      return (
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <Badge variant="secondary" className="h-auto max-w-full font-mono whitespace-normal wrap-anywhere text-left select-text">
            {pattern}
          </Badge>
          {path && <span className="min-w-0 wrap-anywhere text-muted-foreground select-text">{path}</span>}
        </div>
      );
    }
  }

  if (base === "Grep") {
    const pattern = str(obj, "pattern");
    if (pattern !== null) {
      const path = str(obj, "path");
      const glob = str(obj, "glob");
      return (
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <Badge variant="secondary" className="h-auto max-w-full font-mono whitespace-normal wrap-anywhere text-left select-text">
            {pattern}
          </Badge>
          {path && <span className="min-w-0 wrap-anywhere text-muted-foreground select-text">{path}</span>}
          {glob && (
            <Badge variant="secondary" className="h-auto max-w-full font-mono whitespace-normal wrap-anywhere text-left">
              {glob}
            </Badge>
          )}
        </div>
      );
    }
  }

  return <OutputBlock text={prettyJson(input)} maxLines={60} />;
}

export function ToolBody({ name, input, output, outputTone = "default" }: ToolBodyProps) {
  return (
    <div className="flex flex-col gap-3">
      {renderInput(name, input)}
      {output !== null && output.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">{t("chat.output")}</div>
          <OutputBlock text={output} maxLines={60} tone={outputTone} />
        </div>
      )}
    </div>
  );
}
