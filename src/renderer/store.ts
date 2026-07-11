import { create } from "zustand";
import type { AppSettings, AppSnapshot, ProjectSummary, ThemeMode } from "../shared/contracts";

function deriveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return mode;
}

type AppState = {
  snapshot: AppSnapshot | null;
  loading: boolean;
  theme: "dark" | "light";
  error: string | undefined;
  recentLoadingPath: string | undefined;
  bootstrap(): Promise<void>;
  refreshRuntime(): Promise<void>;
  openSource(): Promise<void>;
  openSourcePath(sourcePath: string): Promise<void>;
  openRecentSource(sourcePath: string): Promise<void>;
  selectProject(projectId: string): void;
  updateSettings(settings: Partial<AppSettings>): Promise<void>;
  clearRecents(): Promise<void>;
  activeProject(): ProjectSummary | undefined;
};

export const useAppStore = create<AppState>((set, get) => ({
  snapshot: null,
  loading: true,
  theme: "dark",
  error: undefined,
  recentLoadingPath: undefined,
  async bootstrap() {
    set({ loading: true, error: undefined });

    try {
      const snapshot = await window.dockerExplorer.getSnapshot();
      const runtimeResult = snapshot.projects.length > 0 ? null : await window.dockerExplorer.refreshRuntime();
      const hydrated = runtimeResult?.ok === false ? snapshot : runtimeResult?.data ?? snapshot;
      set({
        snapshot: hydrated,
        loading: false,
        theme: deriveTheme(hydrated.settings.themeMode)
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load Docker Explorer."
      });
    }
  },
  async refreshRuntime() {
    set({ loading: true, error: undefined });
    try {
      const result = await window.dockerExplorer.refreshRuntime();
      if (!result.ok) {
        set({ loading: false, error: result.error.message });
        return;
      }

      set({
        snapshot: result.data,
        loading: false,
        theme: deriveTheme(result.data.settings.themeMode)
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Runtime refresh failed."
      });
    }
  },
  async openSource() {
    set({ loading: true, error: undefined });
    try {
      const result = await window.dockerExplorer.openSource();
      const current = get().snapshot;

      if (!result.ok) {
        set({ loading: false, error: result.error.message });
        return;
      }

      set({
        snapshot: current
          ? {
              ...current,
              projects: [result.data, ...current.projects.filter((project) => project.id !== result.data.id)],
              recents: result.data.sourcePath
                ? [result.data.sourcePath, ...current.recents.filter((entry) => entry !== result.data.sourcePath)].slice(0, 12)
                : current.recents,
              activeProjectId: result.data.id
            }
          : {
              dockerStatus: {
                cliAvailable: false,
                daemonAvailable: false,
                composeAvailable: false,
                buildxAvailable: false,
                message: "Docker status unavailable."
              },
              projects: [result.data],
              recents: result.data.sourcePath ? [result.data.sourcePath] : [],
              activeProjectId: result.data.id,
              settings: {
                themeMode: "dark",
                runtimeRefreshSeconds: 3,
                statsPollSeconds: 3,
                logTailLines: 200
              }
            },
        loading: false
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Opening source failed."
      });
    }
  },
  async openSourcePath(sourcePath) {
    set({ loading: true, error: undefined });
    try {
      const result = await window.dockerExplorer.openSourcePath(sourcePath);
      const current = get().snapshot;

      if (!result.ok) {
        set({ loading: false, error: result.error.message });
        return;
      }

      set({
        snapshot: current
          ? {
              ...current,
              projects: [result.data, ...current.projects.filter((project) => project.id !== result.data.id)],
              recents: result.data.sourcePath
                ? [result.data.sourcePath, ...current.recents.filter((entry) => entry !== result.data.sourcePath)].slice(0, 12)
                : current.recents,
              activeProjectId: result.data.id
            }
          : {
              dockerStatus: {
                cliAvailable: false,
                daemonAvailable: false,
                composeAvailable: false,
                buildxAvailable: false,
                message: "Docker status unavailable."
              },
              projects: [result.data],
              recents: result.data.sourcePath ? [result.data.sourcePath] : [],
              activeProjectId: result.data.id,
              settings: {
                themeMode: "dark",
                runtimeRefreshSeconds: 3,
                statsPollSeconds: 3,
                logTailLines: 200
              }
            },
        loading: false
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Opening source failed."
      });
    }
  },
  async openRecentSource(sourcePath) {
    set({ recentLoadingPath: sourcePath, error: undefined });
    try {
      const result = await window.dockerExplorer.openRecentSource(sourcePath);
      const current = get().snapshot;

      if (!result.ok) {
        set({ recentLoadingPath: undefined, error: result.error.message });
        return;
      }

      set({
        snapshot: current
          ? {
              ...current,
              projects: [result.data, ...current.projects.filter((project) => project.id !== result.data.id)],
              recents: [sourcePath, ...current.recents.filter((entry) => entry !== sourcePath)].slice(0, 12),
              activeProjectId: result.data.id
            }
          : {
              dockerStatus: {
                cliAvailable: false,
                daemonAvailable: false,
                composeAvailable: false,
                buildxAvailable: false,
                message: "Docker status unavailable."
              },
              projects: [result.data],
              recents: [sourcePath],
              activeProjectId: result.data.id,
              settings: {
                themeMode: "dark",
                runtimeRefreshSeconds: 3,
                statsPollSeconds: 3,
                logTailLines: 200
              }
            },
        recentLoadingPath: undefined
      });
    } catch (error) {
      set({
        recentLoadingPath: undefined,
        error: error instanceof Error ? error.message : "Opening recent source failed."
      });
    }
  },
  selectProject(projectId) {
    const snapshot = get().snapshot;
    if (!snapshot) {
      return;
    }

    set({
      snapshot: {
        ...snapshot,
        activeProjectId: projectId
      }
    });
  },
  async updateSettings(settings) {
    const snapshot = await window.dockerExplorer.updateSettings(settings);
    set({
      snapshot,
      theme: deriveTheme(snapshot.settings.themeMode)
    });
  },
  async clearRecents() {
    const snapshot = await window.dockerExplorer.clearRecents();
    set({ snapshot });
  },
  activeProject() {
    const snapshot = get().snapshot;
    if (!snapshot) {
      return undefined;
    }

    return snapshot.projects.find((project) => project.id === snapshot.activeProjectId) ?? snapshot.projects[0];
  }
}));
