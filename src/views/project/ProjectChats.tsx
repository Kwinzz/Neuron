import { useMemo } from "react";
import { MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNav } from "@/stores/nav";
import { useUi } from "@/stores/ui";
import { ProjectChatRow } from "./ProjectChatRow";

interface ProjectChatsProps {
  projectId: string;
}

export function ProjectChats({ projectId }: ProjectChatsProps) {
  const chats = useNav((s) => s.chats);

  const projectChats = useMemo(
    () =>
      chats
        .filter((chat) => chat.projectId === projectId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [chats, projectId],
  );

  return (
    <Card size="sm" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <CardHeader>
        <CardTitle>Chats du projet</CardTitle>
        <CardDescription className="text-xs">
          Chaque nouveau chat reçoit le contexte du projet.
        </CardDescription>
        {projectChats.length > 0 && (
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => useUi.getState().startChat(projectId)}
            >
              <Plus aria-hidden />
              <span>Nouveau chat</span>
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent>
        {projectChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <MessageSquare className="size-5" aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">Aucun chat dans ce projet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Démarre un chat : il recevra automatiquement le contexte du projet.
              </p>
            </div>
            <Button size="sm" onClick={() => useUi.getState().startChat(projectId)}>
              <Plus aria-hidden />
              <span>Nouveau chat</span>
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Chat</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Mis à jour</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectChats.map((thread) => (
                  <ProjectChatRow key={thread.id} thread={thread} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
