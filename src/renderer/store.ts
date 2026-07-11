import { create } from "zustand";
import type {
  AppSettings,
  AppSnapshot,
  ExecutableProjectActionId,
  OperationEvent,
  ProjectSummary,
  ThemeMode
} from "../shared/contracts";

function deriveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return mode;
}

export type OperationState = {
  projectId: string;
  operationId: string;
  actionId: ExecutableProjectActionId;
  status: "running" | "success" | "failed";
  lines: string[];
  startedAt: string;
  finishedAt?: string | undefined;
  errorMessage?: string | undefined;
};

const MAX_OPERATION_LINES = 2000;

/**
 * Selection has exactly one owner: the renderer. `selectedProjectId` lives
 * outside the snapshot precisely so that replacing the snapshot wholesale
 * (periodic refresh, settings update, clearing recents) can never clobber
 * what the user clicked. This helper is the one rule for carrying the
 * selection across a snapshot replacement:
 *
 * - keep the current selection if that project still exists in the new list;
 * - otherwise fall back to `seedHint` (main's activeProjectId) ONLY when
 *   explicitly provided - that happens once at bootstrap and when the user
 *   themselves opened a project. After boot, main's activeProjectId is just
 *   a stale hint and must not be trusted;
 * - otherwise return undefined ("nothing selected"). Deliberately NO
 *   projects[0] fallback: silently jumping to whatever project happens to be
 *   first is exactly the bug this exists to prevent. An undefined selection
 *   sends the user back to the project selector instead.
 */
export function reconcileSelectedProjectId(
  currentId: string | undefined,
  projects: ProjectSummary[],
  seedHint?: string | undefined
): string | undefined {
  if (currentId && projects.some((project) => project.id === currentId)) {
    return currentId;
  }

  if (seedHint && projects.some((project) => project.id === seedHint)) {
    return seedHint;
  }

  return undefined;
}

type AppState = {
  snapshot: AppSnapshot | null;
  loading: boolean;
  theme: "dark" | "light";
  error: string | undefined;
  recentLoadingPath: string | undefined;
  operations: Record<string, OperationState>;
  selectedProjectId: string | undefined;
  bootstrap(): Promise<void>;
  refreshRuntime(): Promise<void>;
  openSource(): Promise<void>;
  openSourcePath(sourcePath: string): Promise<void>;
  openRecentSource(sourcePath: string): Promise<void>;
  selectProject(projectId: string): void;
  updateSettings(settings: Partial<AppSettings>): Promise<void>;
  clearRecents(): Promise<void>;
  activeProject(): ProjectSummary | undefined;
  runProjectAction(projectId: string, actionId: ExecutableProjectActionId): Promise<void>;
  handleOperationEvent(event: OperationEvent): void;
};

export const useAppStore = create<AppState>((set, get) => ({
  snapshot: null,
  operations: {},
  loading: true,
  theme: "dark",
  error: undefined,
  recentLoadingPath: undefined,
  selectedProjectId: undefined,
  async bootstrap() {
    set({ loading: true, error: undefined });

    try {
      const snapshot = await window.dockerExplorer.getSnapshot();

      // Helper to validate that the id actually exists in this snapshot.
      const isValidId = (id: string | undefined) =>
        id && snapshot.projects.some((project) => project.id === id);

      let initialSelection = get().selectedProjectId;

      if (!isValidId(initialSelection)) {
        initialSelection = isValidId(snapshot.activeProjectId) ? snapshot.activeProjectId : undefined;
      }

      set({
        snapshot,
        loading: false,
        theme: deriveTheme(snapshot.settings.themeMode),
        selectedProjectId: initialSelection
      });

      const runtimeResult = await window.dockerExplorer.refreshRuntime();
      if (!runtimeResult.ok) {
        // Runtime discovery failed, but we still have the (empty) snapshot to show -
        // surface the error instead of silently pretending everything is fine.
        set({
          snapshot,
          loading: false,
          error: runtimeResult.error.message,
          theme: deriveTheme(snapshot.settings.themeMode)
        });
        return;
      }

      set({
        snapshot: runtimeResult.data,
        loading: false,
        theme: deriveTheme(runtimeResult.data.settings.themeMode),
        selectedProjectId: reconcileSelectedProjectId(
          get().selectedProjectId,
          runtimeResult.data.projects,
          runtimeResult.data.activeProjectId
        )
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
        theme: deriveTheme(result.data.settings.themeMode),
        // No seed hint here: after boot, main's activeProjectId is stale.
        // Keep whatever the user selected as long as it still exists.
        selectedProjectId: reconcileSelectedProjectId(get().selectedProjectId, result.data.projects)
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
    set({ selectedProjectId: projectId });
  },
  async updateSettings(settings) {
    try {
      const snapshot = await window.dockerExplorer.updateSettings(settings);
      set({
        snapshot,
        error: undefined,
        theme: deriveTheme(snapshot.settings.themeMode)
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update settings."
      });
    }
  },
  async clearRecents() {
    try {
      const snapshot = await window.dockerExplorer.clearRecents();
      set({ snapshot, error: undefined });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to clear recent sources."
      });
    }
  },
  activeProject() {
    const { snapshot, selectedProjectId } = get();
    if (!snapshot) return undefined;

    // Local selection always takes priority.
    return snapshot.projects.find((project) => project.id === selectedProjectId);
  },
  async runProjectAction(projectId, actionId) {
    // Mirrors main's concurrency guard so the button disables instantly
    // instead of waiting on an IPC round trip to find out an operation is
    // already running.
    if (get().operations[projectId]?.status === "running") {
      return;
    }

    set((state) => ({
      operations: {
        ...state.operations,
        [projectId]: {
          projectId,
          operationId: "",
          actionId,
          status: "running",
          lines: [],
          startedAt: new Date().toISOString()
        }
      }
    }));

    try {
      const result = await window.dockerExplorer.runProjectAction(projectId, actionId);

      if (!result.ok) {
        set((state) => {
          const current = state.operations[projectId];
          return {
            operations: {
              ...state.operations,
              [projectId]: {
                projectId,
                operationId: current?.operationId ?? "",
                actionId,
                status: "failed",
                lines: current?.lines ?? [],
                startedAt: current?.startedAt ?? new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                errorMessage: result.error.message
              }
            }
          };
        });
        return;
      }

      set((state) => ({
        snapshot: result.data.snapshot,
        operations: {
          ...state.operations,
          [projectId]: {
            ...(state.operations[projectId] ?? {
              projectId,
              actionId,
              lines: [],
              startedAt: new Date().toISOString()
            }),
            operationId: result.data.operationId,
            status: result.data.outcome.ok ? "success" : "failed",
            finishedAt: new Date().toISOString(),
            errorMessage: result.data.outcome.ok ? undefined : result.data.outcome.detail
          }
        }
      }));
    } catch (error) {
      set((state) => {
        const current = state.operations[projectId];
        return {
          operations: {
            ...state.operations,
            [projectId]: {
              projectId,
              operationId: current?.operationId ?? "",
              actionId,
              status: "failed",
              lines: current?.lines ?? [],
              startedAt: current?.startedAt ?? new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              errorMessage: error instanceof Error ? error.message : "The operation failed unexpectedly."
            }
          }
        };
      });
    }
  },
  handleOperationEvent(event) {
    set((state) => {
      const current = state.operations[event.projectId];

      if (event.kind === "output") {
        const lines = [...(current?.lines ?? []), event.line].slice(-MAX_OPERATION_LINES);
        return {
          operations: {
            ...state.operations,
            [event.projectId]: {
              projectId: event.projectId,
              operationId: event.operationId,
              actionId: event.actionId,
              status: current?.status ?? "running",
              lines,
              startedAt: current?.startedAt ?? new Date().toISOString(),
              finishedAt: current?.finishedAt,
              errorMessage: current?.errorMessage
            }
          }
        };
      }

      return {
        operations: {
          ...state.operations,
          [event.projectId]: {
            projectId: event.projectId,
            operationId: event.operationId,
            actionId: event.actionId,
            status: event.status,
            lines: current?.lines ?? [],
            startedAt: event.startedAt,
            finishedAt: event.finishedAt,
            errorMessage: event.errorMessage
          }
        }
      };
    });
  }
}));

// Wired once at module load, not per-component: operation output/status
// events can arrive for a project the user has since navigated away from
// (e.g. a build keeps running in the background), and the store - not any
// single mounted component - is the right long-lived place to keep listening.
if (typeof window !== "undefined" && window.dockerExplorer) {
  window.dockerExplorer.subscribeBuildEvents((event) => {
    useAppStore.getState().handleOperationEvent(event);
  });
}
