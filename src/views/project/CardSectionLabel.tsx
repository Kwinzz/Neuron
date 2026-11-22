import type { ReactNode } from "react";

interface CardSectionLabelProps {
  children: ReactNode;
  right?: ReactNode;
}

export function CardSectionLabel({ children, right }: CardSectionLabelProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="font-medium text-muted-foreground">{children}</span>
      {right}
    </div>
  );
}
