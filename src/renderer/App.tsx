import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { useAppStore } from "./store";

export function App() {
  const snapshot = useAppStore((state) => state.snapshot);
  const loading = useAppStore((state) => state.loading);
  const theme = useAppStore((state) => state.theme);
  const error = useAppStore((state) => state.error);
  const recentLoadingPath = useAppStore((state) => state.recentLoadingPath);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const refreshRuntime = useAppStore((state) => state.refreshRuntime);
  const openSource = useAppStore((state) => state.openSource);
  const openSourcePath = useAppStore((state) => state.openSourcePath);
  const openRecentSource = useAppStore((state) => state.openRecentSource);
  const selectProject = useAppStore((state) => state.selectProject);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const activeProject = useAppStore((state) => state.activeProject());
  const [screen, setScreen] = useState<"launcher" | "workspace">("launcher");

  const settings = snapshot?.settings;

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Periodic background refresh so running containers' status stays live
  // without the user having to hit the manual refresh button. This is the
  // "periodic runtime refresh" that used to be able to bounce the active
  // project to an unrelated one on every tick - fixed at the source
  // (ProjectService.refreshRuntime/mergeProjectLists), not by removing the
  // poll.
  useEffect(() => {
    const seconds = settings?.runtimeRefreshSeconds;
    if (!seconds) {
      return;
    }

    const intervalId = window.setInterval(() => void refreshRuntime(), seconds * 1000);
    return () => window.clearInterval(intervalId);
  }, [settings?.runtimeRefreshSeconds, refreshRuntime]);

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
            setScreen("workspace");
          }}
          onRefresh={() => void refreshRuntime()}
          onOpenSource={async () => {
            const success = await openSource();
            if (success && useAppStore.getState().activeProject()) {
              setScreen("workspace");
            }
          }}
          onOpenSourcePath={async (sourcePath) => {
            const success = await openSourcePath(sourcePath);
            if (success && useAppStore.getState().activeProject()) {
              setScreen("workspace");
            }
          }}
          onOpenRecent={async (sourcePath) => {
            const success = await openRecentSource(sourcePath);
            if (success && useAppStore.getState().activeProject()) {
              setScreen("workspace");
            }
          }}
          onToggleTheme={() => toggleTheme()}
          recents={snapshot?.recents ?? []}
          recentLoadingPath={recentLoadingPath}
          settings={snapshot?.settings}
        />
      ) : null}

      {screen === "workspace" ? (
        <ProjectWorkspace
          project={activeProject}
          dockerStatus={snapshot?.dockerStatus}
          settings={snapshot?.settings}
          theme={theme}
          loading={loading}
          error={error}
          onBack={() => setScreen("launcher")}
          onRefresh={() => void refreshRuntime()}
          onToggleTheme={() => toggleTheme()}
        />
      ) : null}
    </div>
  );
}
