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
  const updateSettings = useAppStore((state) => state.updateSettings);
  const activeProject = useAppStore((state) => state.activeProject());
  const [screen, setScreen] = useState<"launcher" | "workspace">("launcher");

  const settings = snapshot?.settings;

  async function cycleTheme() {
    const current = settings?.themeMode ?? "dark";
    const next = current === "dark" ? "light" : current === "light" ? "system" : "dark";
    await updateSettings({ themeMode: next });
  }

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
            setScreen("workspace");
          }}
          onRefresh={() => void refreshRuntime()}
          onOpenSource={async () => {
            await openSource();
            setScreen("workspace");
          }}
          onOpenSourcePath={async (sourcePath) => {
            await openSourcePath(sourcePath);
            setScreen("workspace");
          }}
          onOpenRecent={async (sourcePath) => {
            await openRecentSource(sourcePath);
            setScreen("workspace");
          }}
          onToggleTheme={() => void cycleTheme()}
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
          onToggleTheme={() => void cycleTheme()}
        />
      ) : null}
    </div>
  );
}
