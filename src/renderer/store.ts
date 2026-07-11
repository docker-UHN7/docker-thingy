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
  themeModePreference: ThemeMode | undefined;
  error: string | undefined;
  recentLoadingPath: string | undefined;
  operations: Record<string, OperationState>;
  selectedProjectId: string | undefined;
  bootstrap(): Promise<void>;
  refreshRuntime(): Promise<void>;
  openSource(): Promise<boolean>;
  openSourcePath(sourcePath: string): Promise<boolean>;
  openRecentSource(sourcePath: string): Promise<boolean>;
  selectProject(projectId: string): void;
  toggleTheme(): void;
  updateSettings(settings: Partial<AppSettings>): Promise<void>;
  clearRecents(): Promise<void>;
  updateProjectConfigFiles(projectId: string, configFiles: string[]): Promise<void>;
  activeProject(): ProjectSummary | undefined;
  runProjectAction(projectId: string, actionId: ExecutableProjectActionId): Promise<void>;
  handleOperationEvent(event: OperationEvent): void;
};

let pendingThemePersistTimer: ReturnType<typeof setTimeout> | undefined;
let pendingThemePersistMode: ThemeMode | undefined;

export const useAppStore = create<AppState>((set, get) => {
  // openSource/openSourcePath/openRecentSource each get back only the one
  // ProjectSummary the caller asked for, but opening a folder with
  // independent sibling projects (see project.groupId) commits ALL of them
  // on the main side in one shot. Splicing just the returned project into
  // the local snapshot left siblings (and their tab strip / group card)
  // invisible until the next periodic refresh tick happened to run -
  // getSnapshot() is synchronous on main's side (no docker/process calls),
  // so pulling the authoritative snapshot here is instant and always correct.
  async function syncSnapshotAfterOpen(
    projectId: string,
    extraState: Partial<AppState> = {}
  ): Promise<void> {
    const snapshot = await window.dockerExplorer.getSnapshot();
    set({
      snapshot: {
        ...snapshot,
        settings: {
          ...snapshot.settings,
          themeMode: get().themeModePreference ?? snapshot.settings.themeMode
        }
      },
      selectedProjectId: projectId,
      loading: false,
      ...extraState
    });
  }

  return {
    snapshot: null,
    operations: {},
    loading: true,
    theme: "dark",
    themeModePreference: undefined,
    error: undefined,
    recentLoadingPath: undefined,
    selectedProjectId: undefined,
    async bootstrap() {
      set({ loading: true, error: undefined });

      try {
        const snapshot = await window.dockerExplorer.getSnapshot();
        const effectiveSnapshot = {
          ...snapshot,
          settings: {
            ...snapshot.settings,
            themeMode: get().themeModePreference ?? snapshot.settings.themeMode
          }
        };

        // Helper to validate that the id actually exists in this snapshot.
        const isValidId = (id: string | undefined) =>
          id && snapshot.projects.some((project) => project.id === id);

        let initialSelection = get().selectedProjectId;

        if (!isValidId(initialSelection)) {
          initialSelection = isValidId(snapshot.activeProjectId) ? snapshot.activeProjectId : undefined;
        }

        set({
          snapshot: effectiveSnapshot,
          loading: false,
          theme: deriveTheme(effectiveSnapshot.settings.themeMode),
          selectedProjectId: initialSelection
        });

        const runtimeResult = await window.dockerExplorer.refreshRuntime();
        if (!runtimeResult.ok) {
          // Runtime discovery failed, but we still have the (empty) snapshot to show -
          // surface the error instead of silently pretending everything is fine.
          set({
            snapshot: effectiveSnapshot,
            loading: false,
            error: runtimeResult.error.message,
            theme: deriveTheme(effectiveSnapshot.settings.themeMode)
          });
          return;
        }

        const runtimeSnapshot = {
          ...runtimeResult.data,
          settings: {
            ...runtimeResult.data.settings,
            themeMode: get().themeModePreference ?? runtimeResult.data.settings.themeMode
          }
        };

        set({
          snapshot: runtimeSnapshot,
          loading: false,
          theme: deriveTheme(runtimeSnapshot.settings.themeMode),
          selectedProjectId: reconcileSelectedProjectId(
            get().selectedProjectId,
            runtimeSnapshot.projects,
            runtimeSnapshot.activeProjectId
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

        const runtimeSnapshot = {
          ...result.data,
          settings: {
            ...result.data.settings,
            themeMode: get().themeModePreference ?? result.data.settings.themeMode
          }
        };

        set({
          snapshot: runtimeSnapshot,
          loading: false,
          theme: deriveTheme(runtimeSnapshot.settings.themeMode),
          // No seed hint here: after boot, main's activeProjectId is stale.
          // Keep whatever the user selected as long as it still exists.
          selectedProjectId: reconcileSelectedProjectId(get().selectedProjectId, runtimeSnapshot.projects)
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

        if (!result.ok) {
          set({ loading: false, error: result.error.message });
          return false;
        }

        await syncSnapshotAfterOpen(result.data.id);
        return true;
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Opening source failed."
        });
        return false;
      }
    },
    async openSourcePath(sourcePath) {
      set({ loading: true, error: undefined });
      try {
        const result = await window.dockerExplorer.openSourcePath(sourcePath);

        if (!result.ok) {
          set({ loading: false, error: result.error.message });
          return false;
        }

        await syncSnapshotAfterOpen(result.data.id);
        return true;
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Opening source failed."
        });
        return false;
      }
    },
    async openRecentSource(sourcePath) {
      set({ recentLoadingPath: sourcePath, error: undefined });
      try {
        const result = await window.dockerExplorer.openRecentSource(sourcePath);

        if (!result.ok) {
          set({ recentLoadingPath: undefined, error: result.error.message });
          return false;
        }

        await syncSnapshotAfterOpen(result.data.id, { recentLoadingPath: undefined });
        return true;
      } catch (error) {
        set({
          recentLoadingPath: undefined,
          error: error instanceof Error ? error.message : "Opening recent source failed."
        });
        return false;
      }
    },
    selectProject(projectId) {
      set({ selectedProjectId: projectId });
    },
    toggleTheme() {
      const nextMode: ThemeMode = get().theme === "dark" ? "light" : "dark";
      void get().updateSettings({ themeMode: nextMode });
    },
    async updateSettings(settings) {
      const currentSnapshot = get().snapshot;
      const nextThemeMode = settings.themeMode;

      if (nextThemeMode) {
        const optimisticTheme = deriveTheme(nextThemeMode);
        set((state) => ({
          snapshot: state.snapshot
            ? {
                ...state.snapshot,
                settings: {
                  ...state.snapshot.settings,
                  ...settings
                }
              }
            : state.snapshot,
          error: undefined,
          theme: optimisticTheme,
          themeModePreference: nextThemeMode
        }));

        if (pendingThemePersistTimer) {
          clearTimeout(pendingThemePersistTimer);
        }

        pendingThemePersistMode = nextThemeMode;
        pendingThemePersistTimer = setTimeout(() => {
          const modeToPersist = pendingThemePersistMode;
          pendingThemePersistMode = undefined;
          pendingThemePersistTimer = undefined;

          if (!modeToPersist) {
            return;
          }

          void window.dockerExplorer.updateSettings({ themeMode: modeToPersist })
            .then((snapshot) => {
              set({
                snapshot: {
                  ...snapshot,
                  settings: {
                    ...snapshot.settings,
                    themeMode: pendingThemePersistMode ?? snapshot.settings.themeMode
                  }
                },
                error: undefined,
                theme: deriveTheme(snapshot.settings.themeMode),
                themeModePreference: undefined
              });
            })
            .catch((error) => {
              set({
                snapshot: currentSnapshot,
                error: error instanceof Error ? error.message : "Failed to update settings.",
                themeModePreference: undefined
              });
            });
        }, 0);

        return;
      }

      try {
        const snapshot = await window.dockerExplorer.updateSettings(settings);
        set({
          snapshot,
          error: undefined,
          theme: deriveTheme(snapshot.settings.themeMode),
          themeModePreference: undefined
        });
      } catch (error) {
        set({
          snapshot: currentSnapshot,
          error: error instanceof Error ? error.message : "Failed to update settings.",
          themeModePreference: undefined
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
    async updateProjectConfigFiles(projectId, configFiles) {
      try {
        const snapshot = await window.dockerExplorer.updateProjectConfigFiles(projectId, configFiles);
        set({ snapshot, error: undefined });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to update active Compose files."
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
  };
});

// Wired once at module load, not per-component: operation output/status
// events can arrive for a project the user has since navigated away from
// (e.g. a build keeps running in the background), and the store - not any
// single mounted component - is the right long-lived place to keep listening.
if (typeof window !== "undefined" && window.dockerExplorer) {
  window.dockerExplorer.subscribeBuildEvents((event) => {
    useAppStore.getState().handleOperationEvent(event);
  });
}
