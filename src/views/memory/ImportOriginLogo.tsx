import { FileText } from "lucide-react";
import type { MemoryImportOrigin } from "@/bindings/MemoryImportOrigin";
import { VendorLogo } from "@/components/ui/AgentLogo";
import { IMPORT_ORIGINS } from "./importOrigins";

interface ImportOriginLogoProps {
  origin: MemoryImportOrigin;
  size?: number;
  className?: string;
}

/** Vendor mark of an import origin (neutral file glyph for « Autre »). */
export function ImportOriginLogo({ origin, size = 14, className }: ImportOriginLogoProps) {
  const vendor = IMPORT_ORIGINS[origin].vendor;
  if (vendor === "other") {
    return <FileText size={size} className={className} aria-hidden />;
  }
  return <VendorLogo vendor={vendor} size={size} className={className} />;
}
