import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NewMessagesPill({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      className="rounded-full shadow-md animate-in fade-in-0 slide-in-from-bottom-2 zoom-in-95 duration-200 ease-snappy active:scale-[0.97]"
    >
      Nouveaux messages
      <ArrowDown />
    </Button>
  );
}
