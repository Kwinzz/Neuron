import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "brand" | "outline" | "ghost" | "subtle";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  brand: "bg-brand text-white hover:bg-brand-hover active:bg-brand-active",
  outline: "border border-white/80 text-white hover:bg-white/10 active:bg-white/20",
  ghost: "text-fg-muted hover:bg-surface hover:text-fg",
  subtle: "bg-surface text-fg hover:bg-surface-hover",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** Vision button: 12px radius, bold label. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "brand", size = "md", className = "", type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-bold transition-colors duration-fast disabled:pointer-events-none disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    />
  );
});
