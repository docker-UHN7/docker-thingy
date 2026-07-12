import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { NetworkTopologyView } from "./network/NetworkTopologyView";
import { useAppStore } from "./store";

export function App() {
  const snapshot = useAppStore((state) => state.snapshot);
  const loading = useAppStore((state) => state.loading);
  const theme = useAppStore((state) => state.theme);
  const error = useAppStore((state) => state.error);
  const recentLoadingPath = useAppStore((state) => state.recentLoadingPath);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const openSource = useAppStore((state) => state.openSource);
  const createProject = useAppStore((state) => state.createProject);
  const openSourcePath = useAppStore((state) => state.openSourcePath);
  const openRecentSource = useAppStore((state) => state.openRecentSource);
  const selectProject = useAppStore((state) => state.selectProject);
  const touchRecentProject = useAppStore((state) => state.touchRecentProject);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const [screen, setScreen] = useState<"launcher" | "workspace" | "network">("launcher");
  const activeProject = useMemo(
    () => snapshot?.projects.find((project) => project.id === selectedProjectId),
    [snapshot?.projects, selectedProjectId]
  );

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="app-shell" data-theme={theme}>
      {screen === "launcher" ? (
        <Sidebar
          projects={snapshot?.projects ?? []}
          activeProjectId={snapshot?.activeProjectId}
          dockerStatus={snapshot?.dockerStatus}
          loading={loading}
          error={error}
          theme={theme}
          onSelect={(projectId) => {
            selectProject(projectId);
            void touchRecentProject(projectId);
            setScreen("workspace");
          }}
          onOpenSource={async () => {
            const success = await openSource();
            if (success && useAppStore.getState().selectedProjectId) {
              setScreen("workspace");
            }
          }}
          onCreateProject={async () => {
            const success = await createProject();
            if (success && useAppStore.getState().selectedProjectId) {
              setScreen("workspace");
            }
          }}
          onOpenSourcePath={async (sourcePath) => {
            const success = await openSourcePath(sourcePath);
            if (success && useAppStore.getState().selectedProjectId) {
              setScreen("workspace");
            }
          }}
          onOpenRecent={async (sourcePath) => {
            const success = await openRecentSource(sourcePath);
            if (success && useAppStore.getState().selectedProjectId) {
              setScreen("workspace");
            }
          }}
          onToggleTheme={() => toggleTheme()}
          onOpenNetwork={() => setScreen("network")}
          recents={snapshot?.recents ?? []}
          recentLoadingPath={recentLoadingPath}
          settings={snapshot?.settings}
        />
      ) : null}

      {screen === "workspace" ? (
        <ProjectWorkspace
          project={activeProject}
          projects={snapshot?.projects ?? []}
          dockerStatus={snapshot?.dockerStatus}
          settings={snapshot?.settings}
          theme={theme}
          loading={loading}
          error={error}
          onBack={() => setScreen("launcher")}
          onToggleTheme={() => toggleTheme()}
          onSelectProject={(projectId) => {
            selectProject(projectId);
            void touchRecentProject(projectId);
          }}
        />
      ) : null}

      {screen === "network" ? (
        <NetworkTopologyView theme={theme} onBack={() => setScreen("launcher")} onToggleTheme={() => toggleTheme()} />
      ) : null}
    </div>
  );
}
