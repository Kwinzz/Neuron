import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NewMessagesPill({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} className="rounded-full shadow-md">
      Nouveaux messages
      <ArrowDown />
    </Button>
  );
}
