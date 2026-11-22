import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectContextFile } from "@/bindings/ProjectContextFile";
import type { ProjectOverview } from "@/bindings/ProjectOverview";
import { ipc, ipcErrorMessage } from "@/lib/ipc";

interface FileEntry {
  projectId: string;
  data: ProjectContextFile | null;
  error: string | null;
  loading: boolean;
}

interface OverviewEntry {
  projectId: string;
  data: ProjectOverview | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
}

export interface ProjectData {
  file: ProjectContextFile | null;
  overview: ProjectOverview | null;
  loadingFile: boolean;
  loadingOverview: boolean;
  refreshing: boolean;
  errorFile: string | null;
  errorOverview: string | null;
  reloadFile: () => void;
  reloadOverview: () => void;
}

export function useProjectData(projectId: string): ProjectData {
  const [fileEntry, setFileEntry] = useState<FileEntry>({
    projectId,
    data: null,
    error: null,
    loading: true,
  });
  const [overviewEntry, setOverviewEntry] = useState<OverviewEntry>({
    projectId,
    data: null,
    error: null,
    loading: true,
    refreshing: false,
  });

  const fileReqRef = useRef(0);
  const overviewReqRef = useRef(0);

  const fetchFile = useCallback((id: string) => {
    const reqId = ++fileReqRef.current;
    setFileEntry((prev) => ({
      projectId: id,
      data: prev.projectId === id ? prev.data : null,
      error: null,
      loading: true,
    }));

    ipc
      .projectContext(id)
      .then((data) => {
        if (fileReqRef.current !== reqId) return;
        setFileEntry({ projectId: id, data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (fileReqRef.current !== reqId) return;
        setFileEntry({
          projectId: id,
          data: null,
          error: ipcErrorMessage(err),
          loading: false,
        });
      });
  }, []);

  const fetchOverview = useCallback((id: string) => {
    const reqId = ++overviewReqRef.current;
    setOverviewEntry((prev) => {
      const sameProject = prev.projectId === id && prev.data !== null;
      return {
        projectId: id,
        data: sameProject ? prev.data : null,
        error: null,
        loading: !sameProject,
        refreshing: sameProject,
      };
    });

    ipc
      .projectOverview(id)
      .then((data) => {
        if (overviewReqRef.current !== reqId) return;
        setOverviewEntry({
          projectId: id,
          data,
          error: null,
          loading: false,
          refreshing: false,
        });
      })
      .catch((err: unknown) => {
        if (overviewReqRef.current !== reqId) return;
        setOverviewEntry((prev) => ({
          projectId: id,
          data: prev.projectId === id ? prev.data : null,
          error: ipcErrorMessage(err),
          loading: false,
          refreshing: false,
        }));
      });
  }, []);

  useEffect(() => {
    fetchFile(projectId);
    fetchOverview(projectId);

    return () => {
      fileReqRef.current += 1;
      overviewReqRef.current += 1;
    };
  }, [projectId, fetchFile, fetchOverview]);

  const reloadFile = useCallback(() => {
    fetchFile(projectId);
  }, [projectId, fetchFile]);

  const reloadOverview = useCallback(() => {
    fetchOverview(projectId);
  }, [projectId, fetchOverview]);

  const isCurrentFile = fileEntry.projectId === projectId;
  const isCurrentOverview = overviewEntry.projectId === projectId;

  return {
    file: isCurrentFile ? fileEntry.data : null,
    overview: isCurrentOverview ? overviewEntry.data : null,
    loadingFile: isCurrentFile ? fileEntry.loading : true,
    loadingOverview: isCurrentOverview ? overviewEntry.loading : true,
    refreshing: isCurrentOverview ? overviewEntry.refreshing : false,
    errorFile: isCurrentFile ? fileEntry.error : null,
    errorOverview: isCurrentOverview ? overviewEntry.error : null,
    reloadFile,
    reloadOverview,
  };
}
