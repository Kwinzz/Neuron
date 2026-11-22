import { Fragment } from "react";
import { cn } from "cn";
import { formatCliArg, hasPromptPlaceholder } from "./genericCliFormat";

interface GenericCliCommandPreviewProps {
  command: string;
  args: readonly string[];
  showShellPrefix?: boolean;
  showStdinHint?: boolean;
  className?: string;
}

function renderWithPromptHighlight(token: string, keyPrefix: string) {
  const parts = token.split(/(\{prompt\})/g);
  return parts.map((part, idx) =>
    part === "{prompt}" ? (
      <span key={`${keyPrefix}-${idx}`} className="font-medium text-foreground">
        {part}
      </span>
    ) : (
      <Fragment key={`${keyPrefix}-${idx}`}>{part}</Fragment>
    ),
  );
}

export function GenericCliCommandPreview({
  command,
  args,
  showShellPrefix = false,
  showStdinHint = false,
  className,
}: GenericCliCommandPreviewProps) {
  const usesStdin = showStdinHint && command.length > 0 && !hasPromptPlaceholder(args);

  return (
    <code
      className={cn(
        "block min-w-0 font-mono text-xs wrap-anywhere text-muted-foreground",
        className,
      )}
    >
      {showShellPrefix && <span className="select-none text-muted-foreground/60">$ </span>}
      {command ? (
        <>
          <span>{formatCliArg(command)}</span>
          {args.map((arg, index) => (
            <Fragment key={`${index}-${arg}`}>
              {" "}
              {renderWithPromptHighlight(formatCliArg(arg), `arg-${index}`)}
            </Fragment>
          ))}
        </>
      ) : (
        <span className="italic text-muted-foreground/60">commande…</span>
      )}
      {usesStdin && (
        <span className="ml-2 text-muted-foreground/70">← message sur stdin</span>
      )}
    </code>
  );
}
