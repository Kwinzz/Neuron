import type { MemoryImportOrigin } from "@/bindings/MemoryImportOrigin";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CLI_ORIGINS, IMPORT_ORIGINS, WEB_ORIGINS, isMemoryImportOrigin } from "./importOrigins";
import { ImportOriginLogo } from "./ImportOriginLogo";

interface ImportOriginPickerProps {
  id?: string;
  value: MemoryImportOrigin;
  onChange: (origin: MemoryImportOrigin) => void;
  disabled?: boolean;
}

function OriginItem({ origin }: { origin: MemoryImportOrigin }) {
  return (
    <SelectItem value={origin}>
      <ImportOriginLogo origin={origin} className="shrink-0 text-muted-foreground" />
      <span>{IMPORT_ORIGINS[origin].label}</span>
    </SelectItem>
  );
}

export function ImportOriginPicker({ id, value, onChange, disabled = false }: ImportOriginPickerProps) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (isMemoryImportOrigin(next)) onChange(next);
      }}
    >
      <SelectTrigger id={id} size="sm" className="min-w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectGroup>
          <SelectLabel>Assistants web</SelectLabel>
          {WEB_ORIGINS.map((origin) => (
            <OriginItem key={origin} origin={origin} />
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Agents en ligne de commande</SelectLabel>
          {CLI_ORIGINS.map((origin) => (
            <OriginItem key={origin} origin={origin} />
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <OriginItem origin="other" />
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
