import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** "card" = main glass card (22px padding), "tile" = darker tile nested inside a card. */
  variant?: "card" | "tile";
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right side of the header (buttons, switches…). */
  actions?: ReactNode;
  /** Remove inner padding (e.g. full-bleed content). */
  flush?: boolean;
  as?: "section" | "div" | "article";
}

/** Vision-style glass card. */
export function Card({
  variant = "card",
  title,
  subtitle,
  actions,
  flush = false,
  as: Tag = "section",
  className = "",
  children,
  ...rest
}: CardProps) {
  const surface = variant === "card" ? "glass-card" : "glass-tile";
  const padding = flush ? "" : variant === "card" ? "p-[22px]" : "p-4";
  return (
    <Tag className={`relative flex min-w-0 flex-col ${surface} ${padding} ${className}`} {...rest}>
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="truncate text-lg font-bold text-fg">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-sm text-fg-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}
