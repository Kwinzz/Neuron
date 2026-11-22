import { ArrowDown } from "lucide-react";

export function NewMessagesPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pop-in inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-fg shadow-lg transition-colors duration-fast hover:bg-brand-hover"
    >
      Nouveaux messages
      <ArrowDown size={13} />
    </button>
  );
}
