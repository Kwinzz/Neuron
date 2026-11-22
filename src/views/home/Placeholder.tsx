export function Placeholder({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded-md bg-surface/60 ${className}`} />;
}
