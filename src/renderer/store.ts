import { create } from "zustand";
import type {
  AddServiceInput,
  AddServiceResult,
  AppSettings,
  AppSnapshot,
  ExecutableProjectActionId,
  GetServiceFieldsResult,
  OperationEvent,
  ProjectSummary,
  ReadSourceFileResult,
  RemoveServiceResult,
  SaveSourceFileResult,
  SearchDockerHubResult,
  ServiceFieldsInput,
  ThemeMode,
  UpdateServiceFieldsResult
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
 * (live snapshot updates, settings update, clearing recents) can never clobber
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
  applySnapshot(snapshot: AppSnapshot, seedHint?: string | undefined): void;
  openSource(): Promise<boolean>;
  createProject(): Promise<boolean>;
  openSourcePath(sourcePath: string): Promise<boolean>;
  openRecentSource(sourcePath: string): Promise<boolean>;
  selectProject(projectId: string): void;
  toggleTheme(): void;
  updateSettings(settings: Partial<AppSettings>): Promise<void>;
  clearRecents(): Promise<void>;
  updateProjectConfigFiles(projectId: string, configFiles: string[]): Promise<void>;
  readSourceFile(projectId: string, filePath: string): Promise<ReadSourceFileResult>;
  saveSourceFile(
    projectId: string,
    filePath: string,
    sourceText: string,
    expectedHash: string
  ): Promise<SaveSourceFileResult>;
  searchDockerHub(query: string): Promise<SearchDockerHubResult>;
  addServiceToProject(projectId: string, input: AddServiceInput): Promise<AddServiceResult>;
  removeServiceFromProject(projectId: string, serviceName: string): Promise<RemoveServiceResult>;
  getServiceFields(projectId: string, serviceName: string): Promise<GetServiceFieldsResult>;
  updateServiceFields(
    projectId: string,
    serviceName: string,
    fields: ServiceFieldsInput
  ): Promise<UpdateServiceFieldsResult>;
  activeProject(): ProjectSummary | undefined;
  runProjectAction(projectId: string, actionId: ExecutableProjectActionId): Promise<void>;
  handleOperationEvent(event: OperationEvent): void;
};

let pendingThemePersistTimer: ReturnType<typeof setTimeout> | undefined;
let pendingThemePersistMode: ThemeMode | undefined;

export const useAppStore = create<AppState>((set, get) => ({
  snapshot: null,
  operations: {},
  loading: true,
  theme: "dark",
  themeModePreference: undefined,
  error: undefined,
  recentLoadingPath: undefined,
  selectedProjectId: undefined,
  applySnapshot(snapshot, seedHint) {
    const effectiveSnapshot = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        themeMode: get().themeModePreference ?? snapshot.settings.themeMode
      }
    };

    set({
      snapshot: effectiveSnapshot,
      loading: false,
      error: undefined,
      theme: deriveTheme(effectiveSnapshot.settings.themeMode),
      selectedProjectId: reconcileSelectedProjectId(get().selectedProjectId, effectiveSnapshot.projects, seedHint)
    });
  },
  async bootstrap() {
    set({ loading: true, error: undefined });

    try {
      const snapshot = await window.dockerExplorer.getSnapshot();
      get().applySnapshot(snapshot, snapshot.activeProjectId);
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load Docker Explorer."
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
        return false;
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
                statsPollSeconds: 3,
                logTailLines: 200
              }
            },
        selectedProjectId: result.data.id,
        loading: false
      });

      return true;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Opening source failed."
      });
      return false;
    }
  },
  async createProject() {
    set({ loading: true, error: undefined });
    try {
      const result = await window.dockerExplorer.createProject();
      const current = get().snapshot;

      if (!result.ok) {
        set({ loading: false, error: result.error.message });
        return false;
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
                statsPollSeconds: 3,
                logTailLines: 200
              }
            },
        selectedProjectId: result.data.id,
        loading: false
      });

      return true;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Creating project failed."
      });
      return false;
    }
  },
  async openSourcePath(sourcePath) {
    set({ loading: true, error: undefined });
    try {
      const result = await window.dockerExplorer.openSourcePath(sourcePath);
      const current = get().snapshot;

      if (!result.ok) {
        set({ loading: false, error: result.error.message });
        return false;
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
                statsPollSeconds: 3,
                logTailLines: 200
              }
            },
        selectedProjectId: result.data.id,
        loading: false
      });

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
      const current = get().snapshot;

      if (!result.ok) {
        set({ recentLoadingPath: undefined, error: result.error.message });
        return false;
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
                statsPollSeconds: 3,
                logTailLines: 200
              }
            },
        selectedProjectId: result.data.id,
        recentLoadingPath: undefined
      });

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
      get().applySnapshot(snapshot);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update active Compose files."
      });
    }
  },
  async readSourceFile(projectId, filePath) {
    return window.dockerExplorer.readSourceFile(projectId, filePath);
  },
  async saveSourceFile(projectId, filePath, sourceText, expectedHash) {
    const result = await window.dockerExplorer.saveSourceFile(projectId, filePath, sourceText, expectedHash);
    if (result.ok) {
      get().applySnapshot(result.data.snapshot);
    }
    return result;
  },
  async searchDockerHub(query) {
    return window.dockerExplorer.searchDockerHub(query);
  },
  async addServiceToProject(projectId, input) {
    const result = await window.dockerExplorer.addServiceToProject(projectId, input);
    if (result.ok) {
      get().applySnapshot(result.data.snapshot);
    }
    return result;
  },
  async removeServiceFromProject(projectId, serviceName) {
    const result = await window.dockerExplorer.removeServiceFromProject(projectId, serviceName);
    if (result.ok) {
      get().applySnapshot(result.data.snapshot);
    }
    return result;
  },
  async getServiceFields(projectId, serviceName) {
    return window.dockerExplorer.getServiceFields(projectId, serviceName);
  },
  async updateServiceFields(projectId, serviceName, fields) {
    const result = await window.dockerExplorer.updateServiceFields(projectId, serviceName, fields);
    if (result.ok) {
      get().applySnapshot(result.data.snapshot);
    }
    return result;
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
  if (typeof window.dockerExplorer.subscribeBuildEvents === "function") {
    window.dockerExplorer.subscribeBuildEvents((event) => {
      useAppStore.getState().handleOperationEvent(event);
    });
  }

  if (typeof window.dockerExplorer.subscribeSnapshotEvents === "function") {
    window.dockerExplorer.subscribeSnapshotEvents((snapshot) => {
      useAppStore.getState().applySnapshot(snapshot);
    });
  }
}
