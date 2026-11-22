import { AlertCircle } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/stores/dashboard";

interface DashboardErrorProps {
  message: string;
}

export function DashboardError({ message }: DashboardErrorProps) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Impossible de charger le tableau de bord</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void useDashboard.getState().load();
          }}
        >
          Réessayer
        </Button>
      </AlertAction>
    </Alert>
  );
}
