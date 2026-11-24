import { AlertCircle } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useDashboard } from "@/stores/dashboard";

interface DashboardErrorProps {
  message: string;
}

export function DashboardError({ message }: DashboardErrorProps) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{t("home.loadErrorTitle")}</AlertTitle>
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
          {t("common.retry")}
        </Button>
      </AlertAction>
    </Alert>
  );
}
