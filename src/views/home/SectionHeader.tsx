import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  right?: ReactNode;
}

export function SectionHeader({ title, right }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">{title}</h2>
      {right}
    </div>
  );
}
