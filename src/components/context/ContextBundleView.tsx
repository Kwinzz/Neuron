import type { ContextBundle } from "@/bindings/ContextBundle";
import { ContextMarkdown } from "./ContextMarkdown";
import { SourceList } from "./SourceList";

interface ContextBundleViewProps {
  bundle: ContextBundle;
  size?: "sm" | "xs";
  className?: string;
}

export function ContextBundleView({ bundle, size = "sm", className }: ContextBundleViewProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SourceList sources={bundle.sources} />
      <ContextMarkdown markdown={bundle.markdown} size={size} className={className} />
    </div>
  );
}
