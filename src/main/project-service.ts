import { BrowserWindow, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { parseDocument } from "yaml";
import type {
  AddServiceInput,
  AddServiceResult,
  AppSettings,
  AppSnapshot,
  CancelActionResult,
  ConfigDriftResult,
  DockerStatus,
  DriftFinding,
  ExecutableProjectActionId,
  GetServiceFieldsResult,
  LogSnapshotResult,
  OpenSourceResult,
  OperationEvent,
  ProjectActionResult,
  ProjectDiagnostics,
  ProjectSummary,
  ReadSourceFileResult,
  RemoveServiceResult,
  Result,
  SaveSourceFileResult,
  ServiceFieldsInput,
  SnapshotMutationResult,
  StatsSnapshotResult,
  UpdateServiceFieldsResult,
  ValidationOutcome
} from "../shared/contracts";
import { detectServiceDrift } from "./drift-service";
import {
  detectDockerStatus,
  discoverRuntimeProjects,
  fetchContainerLogs,
  fetchContainerStats,
  mergeSourceProjectWithRuntime,
  resolveConfigKey
} from "./docker-service";
import {
  addServiceToCompose,
  applyServiceFieldEdits,
  hashSource,
  listServiceNames,
  loadComposeProject,
  readServiceFields,
  removeDependencyEdge,
  removeServiceFromCompose,
  removeVolumeMount
} from "./compose-service";
import { loadDockerfileProject, validateImageTag } from "./dockerfile-service";
import { executeProjectAction } from "./operation-runner";
import { isTimeoutError } from "./process-runner";
import {
  isValidContainerRef,
  isValidRestartPolicy,
  isValidServiceName,
  normalizeLogTail,
  sanitizeSettingsPatch
} from "./validation";
import { saveSourceAtomically } from "./atomic-save";

const EXECUTABLE_ACTION_IDS: ReadonlySet<string> = new Set<ExecutableProjectActionId>([
  "validate",
  "start",
  "apply-start",
  "stop",
  "build-image"
]);

function isExecutableActionId(value: string): value is ExecutableProjectActionId {
  return EXECUTABLE_ACTION_IDS.has(value);
}

// Dockerfiles reached through a Compose service's build.dockerfile aren't
// necessarily named exactly "Dockerfile" (e.g. "Dockerfile.dev",
// "backend.Dockerfile"), so YAML validation on save has to be skipped by
// filename, not by the owning project's runtimeKind.
function looksLikeDockerfile(filePath: string): boolean {
  const name = (filePath.split(/[/\\]/).pop() ?? "").toLowerCase();
  return name === "dockerfile" || name.startsWith("dockerfile.") || name.endsWith(".dockerfile");
}

/**
 * Merges runtime-discovered Compose projects into any already-open source
 * project that resolves to the exact same config file, instead of appending
 * both as separate cards. Pure/order-preserving so it's unit-testable without
 * touching Docker: source projects keep their position (and stable id -
 * that's what `activeProjectId` points at), matched runtime projects are
 * dropped from the tail, and any runtime project left unmatched is appended
 * as before.
 *
 * This is the fix for the "active project randomly switches" bug: previously
 * the same Compose file could appear as both a `source-compose:...` card
 * (access "editable", from Open Source) and a `runtime-compose:...` card
 * (access "runtime-only", from `docker compose ls`). If the runtime twin
 * temporarily dropped out of `docker compose ls` (e.g. mid apply/stop) while
 * activeProjectId pointed at it, the fallback to `projects[0]` would land on
 * an unrelated, most-recently-opened source project - which, since every one
 * of this user's projects is named "docker-compose.yml", looked like the
 * workspace had jumped to a totally different project.
 */
export function mergeProjectLists(
  contextName: string,
  sourceProjects: ProjectSummary[],
  runtimeProjects: ProjectSummary[]
): ProjectSummary[] {
  const consumedRuntimeIds = new Set<string>();

  const mergedSourceProjects = sourceProjects.map((sourceProject) => {
    if (!sourceProject.sourcePath) {
      return sourceProject;
    }

    const sourceKey = resolveConfigKey(sourceProject.sourcePath);
    const match = runtimeProjects.find(
      (runtimeProject) =>
        !consumedRuntimeIds.has(runtimeProject.id) &&
        runtimeProject.configFiles.some((configFile) => resolveConfigKey(configFile) === sourceKey)
    );

    if (!match) {
      return sourceProject;
    }

    consumedRuntimeIds.add(match.id);
    return mergeSourceProjectWithRuntime(contextName, sourceProject, match);
  });

  const remainingRuntimeProjects = runtimeProjects.filter((project) => !consumedRuntimeIds.has(project.id));
  return [...mergedSourceProjects, ...remainingRuntimeProjects];
}

async function filterExistingRecentSources(paths: string[]): Promise<string[]> {
  const unique = paths.filter((entry, index, all) => Boolean(entry) && all.indexOf(entry) === index).slice(0, 24);
  const checks = await Promise.all(
    unique.map(async (path) => {
      try {
        await access(path);
        return path;
      } catch {
        return undefined;
      }
    })
  );

  return checks.filter((entry): entry is string => Boolean(entry)).slice(0, 12);
}

async function resolveRecentPathForProject(project: ProjectSummary): Promise<string | undefined> {
  const candidates = [
    project.sourcePath,
    ...project.configFiles,
    ...(project.allConfigFiles ?? []),
    ...(project.dockerfilePaths ?? [])
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return undefined;
}

interface ComposeProjectGroup {
  mainFile: string;
  relatedFiles: string[];
  allConfigFiles: string[];
  defaultSelected: string[];
}

export async function scanDirectoryForComposeProjects(directoryPath: string): Promise<ComposeProjectGroup[]> {
  try {
    const entries = await readdir(directoryPath);
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(directoryPath, entry);
      try {
        const info = await stat(fullPath);
        if (info.isFile()) {
          const ext = extname(entry).toLowerCase();
          if ((ext === ".yml" || ext === ".yaml") && entry.toLowerCase().includes("compose")) {
            files.push(entry);
          }
        }
      } catch {
        // Ignore files we cannot stat
      }
    }

    const groupsMap = new Map<string, string[]>();
    for (const file of files) {
      const ext = extname(file);
      const baseName = basename(file, ext);

      const dotIndex = baseName.indexOf(".");
      const parentBase = dotIndex === -1 ? baseName : baseName.slice(0, dotIndex);

      let list = groupsMap.get(parentBase);
      if (!list) {
        list = [];
        groupsMap.set(parentBase, list);
      }
      list.push(file);
    }

    const projectGroups: ComposeProjectGroup[] = [];

    for (const [parentBase, groupFiles] of groupsMap.entries()) {
      const standardOrder = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
      let mainFile: string | undefined;

      for (const std of standardOrder) {
        if (groupFiles.includes(std)) {
          mainFile = std;
          break;
        }
      }

      if (!mainFile) {
        mainFile = groupFiles.find((file) => {
          const ext = extname(file);
          const baseName = basename(file, ext);
          return baseName === parentBase;
        });
      }

      if (!mainFile) {
        mainFile = groupFiles[0];
      }

      if (!mainFile) {
        continue;
      }

      const mainFullPath = join(directoryPath, mainFile);

      const relatedFiles = groupFiles
        .filter((file) => file !== mainFile)
        .map((file) => join(directoryPath, file));

      const allConfigFiles = [mainFullPath, ...relatedFiles];

      const defaultSelected = [mainFullPath];
      const mainExt = extname(mainFile);
      const mainBaseName = basename(mainFile, mainExt);
      const expectedOverrideName = `${mainBaseName}.override${mainExt}`;
      const overrideCandidates = [
        expectedOverrideName,
        "compose.override.yaml",
        "compose.override.yml",
        "docker-compose.override.yaml",
        "docker-compose.override.yml"
      ];

      for (const related of groupFiles.filter((f) => f !== mainFile)) {
        if (overrideCandidates.includes(related) || related.toLowerCase().includes(".override.")) {
          defaultSelected.push(join(directoryPath, related));
        }
      }

      projectGroups.push({
        mainFile: mainFullPath,
        relatedFiles,
        allConfigFiles,
        defaultSelected
      });
    }

    return projectGroups;
  } catch {
    return [];
  }
}

// When a single folder scan turns up more than one independent project
// (e.g. docker-compose-auth.yml and docker-compose-payment.yml), tag them all
// with the same groupId so the sidebar can fold them into one card and the
// workspace can offer a tab strip to switch between them, instead of forcing
// the user back out to the launcher every time. A lone project gets no group.
export function applyProjectGrouping(directoryPath: string, projects: ProjectSummary[]): ProjectSummary[] {
  if (projects.length <= 1) {
    return projects;
  }

  const groupLabel = basename(directoryPath);
  return projects.map((project) => ({
    ...project,
    groupId: directoryPath,
    groupLabel
  }));
}

const NEW_PROJECT_COMPOSE_TEMPLATE = `# New Compose project - use "Add service" in the app to add your first
# service from a preset or Docker Hub, or edit this file directly.
services: {}
`;

const DEFAULT_SETTINGS: AppSettings = {
  themeMode: "dark",
  statsPollSeconds: 3,
  logTailLines: 200
};

// Native dialogs shown without an owning BrowserWindow are unattached, and on
// Windows the app window doesn't reliably regain keyboard focus once they
// close - clicks land but typing (e.g. in the search box) silently does
// nothing until the window is refocused another way. Passing the window
// keeps the dialog modal to it and Electron restores focus correctly.
function dialogParentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  const parentWindow = dialogParentWindow();
  return parentWindow ? dialog.showOpenDialog(parentWindow, options) : dialog.showOpenDialog(options);
}

function showMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const parentWindow = dialogParentWindow();
  return parentWindow ? dialog.showMessageBox(parentWindow, options) : dialog.showMessageBox(options);
}

export class ProjectService {
  // Every public method below reads `this.snapshot`, awaits I/O, then writes
  // a new snapshot back. Without serializing those read-await-write spans,
  // two concurrent calls (e.g. runtime sync racing an openSourcePath) could
  // interleave, and whichever resolves last would silently clobber the
  // other's update. withLock chains mutating operations onto a single
  // promise so they always run to completion one at a time, in call order.
  private lock: Promise<unknown> = Promise.resolve();

  private withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lock.then(operation, operation);
    this.lock = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  // Tracks which project ids currently have a long-running operation
  // (validate/apply-start/stop/build-image) in flight, keyed by project id -
  // both the concurrency guard for "don't start a second operation on the
  // same project" and, via `controller`, the handle cancelProjectAction uses
  // to actually kill the underlying docker/compose process on demand.
  // Deliberately NOT folded into `lock`: that lock only guards short
  // read-await-write snapshot spans, whereas a build can run for minutes and
  // must not block unrelated snapshot reads/writes (e.g. synchronizing a
  // different project) for that whole time.
  private activeOperations = new Map<
    string,
    { actionId: ExecutableProjectActionId; controller: AbortController }
  >();
  private snapshotListeners = new Set<(snapshot: AppSnapshot) => void>();
  private sourceWatchers = new Map<string, FSWatcher>();
  private sourceReloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private runtimeSyncTimer: ReturnType<typeof setTimeout> | undefined;
  private dockerEventRestartTimer: ReturnType<typeof setTimeout> | undefined;
  private dockerEventBuffer = "";
  private dockerEventProcess: ChildProcessWithoutNullStreams | undefined;
  private disposed = false;
  private fallbackSyncInterval: ReturnType<typeof setInterval> | undefined;
  private cachedDockerStatus: { value: DockerStatus; expiresAt: number } | undefined;

  private snapshot: AppSnapshot = {
    dockerStatus: {
      cliAvailable: false,
      daemonAvailable: false,
      composeAvailable: false,
      buildxAvailable: false,
      message: "Checking Docker status..."
    },
    projects: [],
    recents: [],
    settings: DEFAULT_SETTINGS
  };

  subscribeSnapshots(listener: (snapshot: AppSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  startAutoSync(): void {
    this.reconcileSourceWatchers();
    this.ensureDockerEventStream();

    // `docker events` is the fast path for picking up state changes, but
    // it's a single long-lived subprocess - if it misses an event, silently
    // wedges, or the daemon's event stream hiccups (all things that happen
    // in practice, especially against Docker Desktop's Windows/WSL relay),
    // nothing else was correcting for it and the UI could show a stopped
    // container as "running" indefinitely. This periodic sweep is a low-cost
    // safety net so the UI self-heals within a bounded time either way.
    if (!this.fallbackSyncInterval) {
      this.fallbackSyncInterval = setInterval(() => {
        this.scheduleRuntimeSync(0);
      }, 15_000);
      this.fallbackSyncInterval.unref?.();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.fallbackSyncInterval) {
      clearInterval(this.fallbackSyncInterval);
      this.fallbackSyncInterval = undefined;
    }
    if (this.runtimeSyncTimer) {
      clearTimeout(this.runtimeSyncTimer);
      this.runtimeSyncTimer = undefined;
    }
    if (this.dockerEventRestartTimer) {
      clearTimeout(this.dockerEventRestartTimer);
      this.dockerEventRestartTimer = undefined;
    }
    if (this.dockerEventProcess && !this.dockerEventProcess.killed) {
      this.dockerEventProcess.kill();
    }
    this.dockerEventProcess = undefined;
    for (const timer of this.sourceReloadTimers.values()) {
      clearTimeout(timer);
    }
    this.sourceReloadTimers.clear();
    for (const watcher of this.sourceWatchers.values()) {
      watcher.close();
    }
    this.sourceWatchers.clear();
  }

  private emitSnapshot(): void {
    this.reconcileSourceWatchers();
    for (const listener of this.snapshotListeners) {
      listener(this.snapshot);
    }
  }

  private scheduleRuntimeSync(delayMs = 180): void {
    if (this.runtimeSyncTimer) {
      clearTimeout(this.runtimeSyncTimer);
    }

    this.runtimeSyncTimer = setTimeout(() => {
      this.runtimeSyncTimer = undefined;
      void this.synchronizeSnapshot();
    }, delayMs);
  }

  private ensureDockerEventStream(): void {
    if (this.disposed || this.dockerEventProcess) {
      return;
    }

    const child = spawn("docker", ["events", "--format", "{{json .}}"], {
      windowsHide: true
    });
    this.dockerEventProcess = child;
    this.dockerEventBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      this.dockerEventBuffer += chunk.toString("utf8");
      const lines = this.dockerEventBuffer.split(/\r?\n/);
      this.dockerEventBuffer = lines.pop() ?? "";
      if (lines.some((line) => line.trim().length > 0)) {
        this.scheduleRuntimeSync();
      }
    });

    child.on("error", () => {
      this.dockerEventProcess = undefined;
      this.scheduleDockerEventRestart();
    });

    child.on("close", () => {
      this.dockerEventProcess = undefined;
      this.scheduleDockerEventRestart();
    });
  }

  private scheduleDockerEventRestart(): void {
    if (this.disposed) {
      return;
    }

    if (this.dockerEventRestartTimer) {
      clearTimeout(this.dockerEventRestartTimer);
    }

    this.dockerEventRestartTimer = setTimeout(() => {
      this.dockerEventRestartTimer = undefined;
      this.ensureDockerEventStream();
    }, 3_000);
  }

  // Watches every active config file (not just each project's primary/anchor
  // file) so external edits to a checked-on override file trigger a live
  // reload too, not only edits to the base file.
  private reconcileSourceWatchers(): void {
    const watchedPaths = new Set(
      this.snapshot.projects
        .filter((project) => project.access !== "runtime-only")
        .flatMap((project) => (project.configFiles.length > 0 ? project.configFiles : project.sourcePath ? [project.sourcePath] : []))
    );

    for (const [sourcePath, watcher] of this.sourceWatchers) {
      if (watchedPaths.has(sourcePath)) {
        continue;
      }
      watcher.close();
      this.sourceWatchers.delete(sourcePath);
    }

    for (const sourcePath of watchedPaths) {
      if (this.sourceWatchers.has(sourcePath)) {
        continue;
      }

      try {
        const watcher = watch(sourcePath, { persistent: false }, () => {
          this.scheduleSourceReload(sourcePath);
        });
        watcher.on("error", () => {
          watcher.close();
          this.sourceWatchers.delete(sourcePath);
        });
        this.sourceWatchers.set(sourcePath, watcher);
      } catch {
        // Ignore watch failures for paths that momentarily disappear.
      }
    }
  }

  private scheduleSourceReload(changedPath: string): void {
    const existing = this.sourceReloadTimers.get(changedPath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.sourceReloadTimers.delete(changedPath);
      void this.reloadProjectsWatchingPath(changedPath);
    }, 180);

    this.sourceReloadTimers.set(changedPath, timer);
  }

  // A changed file can be the anchor of one project or an override shared by
  // several (grouped siblings, or - rarely - two unrelated projects pointing
  // at the same override) - reload every project whose active configFiles
  // include it, not just the one whose sourcePath matches literally.
  private async reloadProjectsWatchingPath(changedPath: string): Promise<void> {
    const affectedProjects = this.snapshot.projects.filter(
      (project) => project.access !== "runtime-only" && project.configFiles.includes(changedPath)
    );

    for (const project of affectedProjects) {
      await this.reloadSourceProject(project, changedPath);
    }
  }

  private async reloadSourceProject(project: ProjectSummary, changedPath: string): Promise<void> {
    try {
      const mainPath = project.sourcePath ?? project.configFiles[0];
      if (!mainPath) {
        return;
      }

      await access(mainPath);
      const isDockerfile = project.runtimeKind === "dockerfile";
      const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
      const reloaded = isDockerfile
        ? await loadDockerfileProject(mainPath, contextName)
        : await loadComposeProject(mainPath, contextName, project.configFiles);

      if (project.allConfigFiles) {
        reloaded.allConfigFiles = project.allConfigFiles;
      }
      if (project.groupId) {
        reloaded.groupId = project.groupId;
        reloaded.groupLabel = project.groupLabel;
      }

      const sourceText = await readFile(mainPath, "utf8");

      await this.withLock(async () => {
        const runtimeProjects = this.snapshot.projects.filter((entry) => entry.access === "runtime-only");
        const sourceProjects = this.snapshot.projects.filter(
          (entry) => entry.access !== "runtime-only" && entry.id !== reloaded.id
        );
        const mergedProjects = mergeProjectLists(reloaded.contextName, [reloaded, ...sourceProjects], runtimeProjects);

        this.snapshot = {
          ...this.snapshot,
          projects: mergedProjects,
          activeProjectId:
            this.snapshot.activeProjectId && mergedProjects.some((entry) => entry.id === this.snapshot.activeProjectId)
              ? this.snapshot.activeProjectId
              : mergedProjects[0]?.id,
          activeSourceSession:
            this.snapshot.activeSourceSession?.sourcePath === changedPath
              ? {
                  ...this.snapshot.activeSourceSession,
                  revision: this.snapshot.activeSourceSession.revision + 1,
                  lastKnownHash: hashSource(sourceText),
                  diffPreview: "Updated from disk"
                }
              : this.snapshot.activeSourceSession
        };
      });

      this.emitSnapshot();
    } catch {
      // Ignore transient source reload errors and keep the last known snapshot.
    }
  }

  async getSnapshot(): Promise<AppSnapshot> {
    return this.snapshot;
  }

  // detectDockerStatus shells out to `docker` five times in a row
  // (--version, context show, version, compose version, buildx version).
  // synchronizeSnapshot used to call it unconditionally on every run, but it
  // runs on every single docker event (container health ticks, log writes,
  // etc.) - on an active project that's dozens of extra CLI spawns a minute
  // for values (CLI/daemon availability, active context, versions) that
  // essentially never change between two events a few seconds apart. Caching
  // it briefly cuts that back to roughly once per TTL window instead of once
  // per sync, which is most of where the "feels slow" was coming from.
  private async getDockerStatus(): Promise<DockerStatus> {
    const now = Date.now();
    if (this.cachedDockerStatus && this.cachedDockerStatus.expiresAt > now) {
      return this.cachedDockerStatus.value;
    }

    const value = await detectDockerStatus();
    this.cachedDockerStatus = { value, expiresAt: now + 8_000 };
    return value;
  }

  async synchronizeSnapshot(): Promise<AppSnapshot> {
    return this.withLock(async () => {
      try {
        const dockerStatus = await this.getDockerStatus();
        const runtimeProjects = await discoverRuntimeProjects(dockerStatus);
        const sourceProjects = this.snapshot.projects.filter((project) => project.access !== "runtime-only");
        const contextName = dockerStatus.contextName ?? this.snapshot.dockerStatus.contextName ?? "unknown-context";
        // Dedupe: a project opened from source and its runtime-discovered twin
        // (same resolved Compose file) are merged into one card here rather
        // than shown side by side - see mergeProjectLists for why that matters
        // for keeping the active selection stable across live syncs.
        const projects = mergeProjectLists(contextName, sourceProjects, runtimeProjects);
        // Only remember paths we've actually confirmed exist/loaded (a source
        // project's own sourcePath, or a runtime project's sourcePath once
        // mergeRuntimeProjectWithSource has verified a matching Compose file).
        // runtimeProject.configFiles holds every *candidate* path split out of
        // `docker compose ls`'s ConfigFiles column, most of which were never
        // opened successfully - surfacing those in "recents" would offer the
        // user broken links.
        const derivedRecents = await filterExistingRecentSources(this.snapshot.recents);

        this.snapshot = {
          ...this.snapshot,
          dockerStatus,
          projects,
          recents: derivedRecents,
          activeProjectId:
            this.snapshot.activeProjectId && projects.some((project) => project.id === this.snapshot.activeProjectId)
              ? this.snapshot.activeProjectId
              : projects[0]?.id
        };

        this.emitSnapshot();
        return this.snapshot;
      } catch {
        // Don't let a stale "everything's fine" cache paper over a real
        // failure - next sync (including the periodic fallback one) should
        // actually re-check rather than reusing the last good status.
        this.cachedDockerStatus = undefined;
        this.snapshot = {
          ...this.snapshot,
          dockerStatus: {
            cliAvailable: false,
            daemonAvailable: false,
            composeAvailable: false,
            buildxAvailable: false,
            contextName: this.snapshot.dockerStatus.contextName,
            message: "Docker status could not be synchronized right now.",
            checkedAt: new Date().toISOString()
          },
          projects: this.snapshot.projects.filter((project) => project.access !== "runtime-only"),
          activeProjectId: this.snapshot.activeProjectId
        };

        this.emitSnapshot();
        return this.snapshot;
      }
    });
  }

  private async loadProjectFromPath(sourcePath: string): Promise<ProjectSummary> {
    const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
    return /(^|[\\/])dockerfile$/i.test(sourcePath)
      ? loadDockerfileProject(sourcePath, contextName)
      : loadComposeProject(sourcePath, contextName);
  }

  private async commitOpenedProjects(
    sourcePath: string,
    mainProject: ProjectSummary,
    newProjects: ProjectSummary[]
  ): Promise<OpenSourceResult> {
    const sourceText = await readFile(sourcePath, "utf8");
    const runtimeProjects = this.snapshot.projects.filter((entry) => entry.access === "runtime-only");
    const newProjectIds = new Set(newProjects.map((entry) => entry.id));
    const otherSourceProjects = this.snapshot.projects.filter(
      (entry) => entry.access !== "runtime-only" && !newProjectIds.has(entry.id)
    );
    const mergedProjects = mergeProjectLists(mainProject.contextName, [...newProjects, ...otherSourceProjects], runtimeProjects);
    const mergedMainProject = mergedProjects.find((entry) => entry.id === mainProject.id) ?? mainProject;

    this.snapshot = {
      ...this.snapshot,
      projects: mergedProjects,
      recents: [sourcePath, ...this.snapshot.recents.filter((entry) => entry !== sourcePath)].slice(0, 12),
      activeProjectId: mainProject.id,
      activeSourceSession: {
        id: mainProject.id,
        sourcePath,
        revision: 1,
        lastKnownHash: hashSource(sourceText),
        diffPreview: "No pending changes"
      }
    };
    this.emitSnapshot();

    return {
      ok: true,
      data: mergedMainProject
    };
  }

  async openSource(): Promise<OpenSourceResult> {
    const result = await showOpenDialog({
      properties: ["openDirectory"]
    });

    const directoryPath = result.filePaths[0];
    if (!directoryPath) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "No folder was selected."
        }
      };
    }

    return this.withLock(async () => {
      const groups = await scanDirectoryForComposeProjects(directoryPath);
      const dockerfilePath = join(directoryPath, "Dockerfile");
      let hasDockerfile = false;
      try {
        await access(dockerfilePath);
        hasDockerfile = true;
      } catch {}

      if (groups.length === 0 && !hasDockerfile) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "No docker-compose.yml, compose.yaml, or Dockerfile was found in the selected folder."
          }
        };
      }

      const loadedProjects: ProjectSummary[] = [];
      const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";

      for (const group of groups) {
        try {
          const project = await loadComposeProject(group.mainFile, contextName, group.defaultSelected);
          project.allConfigFiles = group.allConfigFiles;
          loadedProjects.push(project);
        } catch {
          // Ignore single load errors
        }
      }

      if (hasDockerfile) {
        try {
          const project = await loadDockerfileProject(dockerfilePath, contextName);
          loadedProjects.push(project);
        } catch {}
      }

      if (loadedProjects.length === 0) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Could not successfully parse any projects in the selected folder."
          }
        };
      }

      const groupedProjects = applyProjectGrouping(directoryPath, loadedProjects);
      const mainProject = groupedProjects[0];
      if (!mainProject) {
        return {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: "Could not successfully parse any projects in the selected folder." }
        };
      }

      return this.commitOpenedProjects(mainProject.sourcePath || mainProject.configFiles[0] || dockerfilePath, mainProject, groupedProjects);
    });
  }

  /**
   * "Create project": picks a folder and either scaffolds a fresh, empty
   * docker-compose.yml there (the common case - build the project up from
   * scratch via "Add service" or the editor), or, if that folder already
   * has a Compose project or Dockerfile, asks whether to open the existing
   * one instead of silently creating a second, conflicting compose file.
   */
  async createProject(): Promise<OpenSourceResult> {
    const result = await showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });

    const directoryPath = result.filePaths[0];
    if (!directoryPath) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "No folder was selected." }
      };
    }

    const groups = await scanDirectoryForComposeProjects(directoryPath);
    const dockerfilePath = join(directoryPath, "Dockerfile");
    let hasDockerfile = false;
    try {
      await access(dockerfilePath);
      hasDockerfile = true;
    } catch {}

    if (groups.length > 0 || hasDockerfile) {
      const choice = await showMessageBox({
        type: "question",
        buttons: ["Open existing project", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        message: "This folder already has a Compose project",
        detail: "Open the existing project instead of creating a new one? Choose an empty folder to create a fresh project."
      });

      if (choice.response !== 0) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "That folder already contains a project. Pick an empty folder to create a new one, or open the existing project."
          }
        };
      }

      const mainFile = groups[0]?.mainFile ?? dockerfilePath;
      return this.openSourcePath(mainFile);
    }

    return this.withLock(async () => {
      const newComposePath = join(directoryPath, "docker-compose.yml");
      await writeFile(newComposePath, NEW_PROJECT_COMPOSE_TEMPLATE, "utf8");

      const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
      const project = await loadComposeProject(newComposePath, contextName, [newComposePath]);
      return this.commitOpenedProjects(newComposePath, project, [project]);
    });
  }

  async openSourcePath(sourcePath: string): Promise<OpenSourceResult> {
    if (typeof sourcePath !== "string" || sourcePath.trim() === "") {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "No source path was provided." }
      };
    }

    return this.withLock(async () => {
      try {
        await access(sourcePath);
        const directoryPath = dirname(sourcePath);
        const isDockerfile = /(^|[\\/])dockerfile$/i.test(sourcePath);

        if (isDockerfile) {
          const project = await this.loadProjectFromPath(sourcePath);
          return this.commitOpenedProjects(sourcePath, project, [project]);
        }

        const groups = await scanDirectoryForComposeProjects(directoryPath);
        const matchingGroup = groups.find((g) => g.allConfigFiles.includes(sourcePath)) ?? {
          mainFile: sourcePath,
          relatedFiles: [],
          allConfigFiles: [sourcePath],
          defaultSelected: [sourcePath]
        };

        const activeFiles = [...matchingGroup.defaultSelected];
        if (matchingGroup.mainFile && !activeFiles.includes(matchingGroup.mainFile)) {
          activeFiles.push(matchingGroup.mainFile);
        }

        const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
        const mainFile = matchingGroup.mainFile || sourcePath;
        const loadedProject = await loadComposeProject(mainFile, contextName, activeFiles);

        loadedProject.allConfigFiles = matchingGroup.allConfigFiles ?? [mainFile];

        const otherLoadedProjects: ProjectSummary[] = [];
        for (const g of groups) {
          if (g.mainFile === matchingGroup.mainFile) {
            continue;
          }
          try {
            const p = await loadComposeProject(g.mainFile, contextName, g.defaultSelected);
            p.allConfigFiles = g.allConfigFiles;
            otherLoadedProjects.push(p);
          } catch {}
        }

        const groupedProjects = applyProjectGrouping(directoryPath, [loadedProject, ...otherLoadedProjects]);
        return this.commitOpenedProjects(sourcePath, groupedProjects[0] ?? loadedProject, groupedProjects);
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: error instanceof Error ? error.message : "Unable to open the selected file."
          }
        };
      }
    });
  }

  async openRecentSource(sourcePath: string): Promise<OpenSourceResult> {
    return this.openSourcePath(sourcePath);
  }

  async touchRecentProject(projectId: string): Promise<AppSnapshot> {
    return this.withLock(async () => {
      const project = this.snapshot.projects.find((entry) => entry.id === projectId);
      if (!project) {
        return this.snapshot;
      }

      const recentPath = await resolveRecentPathForProject(project);
      if (!recentPath) {
        return this.snapshot;
      }

      this.snapshot = {
        ...this.snapshot,
        recents: [recentPath, ...this.snapshot.recents.filter((entry) => entry !== recentPath)].slice(0, 12)
      };
      this.emitSnapshot();
      return this.snapshot;
    });
  }

  async updateProjectConfigFiles(projectId: string, configFiles: string[]): Promise<AppSnapshot> {
    return this.withLock(async () => {
      const project = this.snapshot.projects.find((p) => p.id === projectId);
      if (!project || project.runtimeKind !== "compose") {
        throw new Error("Project not found or is not a Compose project.");
      }

      const mainPath = project.sourcePath ?? project.configFiles[0];
      if (!mainPath) {
        throw new Error("Project has no known source path.");
      }

      const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
      const updatedProject = await loadComposeProject(mainPath, contextName, configFiles);

      if (project.allConfigFiles) {
        updatedProject.allConfigFiles = project.allConfigFiles;
      }

      // loadComposeProject builds a fresh ProjectSummary from the YAML files
      // alone, so it knows nothing about the folder-scan grouping applied at
      // open time. Without carrying these over, toggling a checkbox would
      // silently knock the project out of its group and drop its tab strip.
      if (project.groupId) {
        updatedProject.groupId = project.groupId;
        updatedProject.groupLabel = project.groupLabel;
      }

      this.snapshot = {
        ...this.snapshot,
        projects: this.snapshot.projects.map((p) =>
          p.id === projectId ? updatedProject : p
        )
      };
      this.emitSnapshot();

      return this.snapshot;
    });
  }

  // Only a path the project actually declared - its active configFiles, a
  // sibling compose file discovered alongside it, or a Dockerfile resolved
  // from one of its services' build.context/build.dockerfile - may be read
  // or written through the editor. The renderer only ever sends a
  // projectId + path pair, and without this check that path could be
  // steered at an arbitrary file on disk.
  private resolveEditableFile(projectId: string, filePath: string): { project: ProjectSummary } | undefined {
    const project = this.snapshot.projects.find((entry) => entry.id === projectId);
    if (!project || (project.runtimeKind !== "compose" && project.runtimeKind !== "dockerfile")) {
      return undefined;
    }

    const allowedFiles = new Set([
      ...(project.sourcePath ? [project.sourcePath] : []),
      ...project.configFiles,
      ...(project.allConfigFiles ?? []),
      ...(project.dockerfilePaths ?? [])
    ]);
    if (!allowedFiles.has(filePath)) {
      return undefined;
    }

    return { project };
  }

  async readSourceFile(projectId: string, filePath: string): Promise<ReadSourceFileResult> {
    if (!this.resolveEditableFile(projectId, filePath)) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "That file is not part of this project." }
      };
    }

    try {
      const sourceText = await readFile(filePath, "utf8");
      return { ok: true, data: { sourceText, hash: hashSource(sourceText) } };
    } catch (error) {
      return {
        ok: false,
        error: { code: "PROCESS_FAILED", message: error instanceof Error ? error.message : "Unable to read file." }
      };
    }
  }

  async saveSourceFile(
    projectId: string,
    filePath: string,
    sourceText: string,
    expectedHash: string
  ): Promise<SaveSourceFileResult> {
    return this.withLock(async () => {
      const resolved = this.resolveEditableFile(projectId, filePath);
      if (!resolved) {
        return {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: "That file is not part of this project." }
        };
      }

      // Dockerfiles aren't YAML - only compose files get parsed for a syntax
      // check before hitting disk.
      if (!looksLikeDockerfile(filePath)) {
        const parsed = parseDocument(sourceText);
        if (parsed.errors.length > 0) {
          return {
            ok: false,
            error: { code: "VALIDATION_FAILED", message: `Invalid YAML: ${parsed.errors[0]!.message}` }
          };
        }
      }

      const saveResult = await saveSourceAtomically(filePath, sourceText, expectedHash);
      if (!saveResult.ok) {
        return saveResult;
      }

      const { project } = resolved;
      const mainPath = project.sourcePath ?? project.configFiles[0];
      if (!mainPath) {
        return { ok: true, data: { hash: saveResult.data.hash, snapshot: this.snapshot } };
      }

      const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
      const reloaded =
        project.runtimeKind === "dockerfile"
          ? await loadDockerfileProject(mainPath, contextName)
          : await loadComposeProject(mainPath, contextName, project.configFiles);
      if (project.allConfigFiles) {
        reloaded.allConfigFiles = project.allConfigFiles;
      }
      if (project.groupId) {
        reloaded.groupId = project.groupId;
        reloaded.groupLabel = project.groupLabel;
      }

      const runtimeProjects = this.snapshot.projects.filter((entry) => entry.access === "runtime-only");
      const sourceProjects = this.snapshot.projects.filter(
        (entry) => entry.access !== "runtime-only" && entry.id !== reloaded.id
      );
      const mergedProjects = mergeProjectLists(reloaded.contextName, [reloaded, ...sourceProjects], runtimeProjects);

      this.snapshot = {
        ...this.snapshot,
        projects: mergedProjects,
        activeSourceSession:
          this.snapshot.activeSourceSession?.sourcePath === mainPath
            ? {
                ...this.snapshot.activeSourceSession,
                revision: this.snapshot.activeSourceSession.revision + 1,
                lastKnownHash: filePath === mainPath ? saveResult.data.hash : this.snapshot.activeSourceSession.lastKnownHash,
                diffPreview: "Saved from editor"
              }
            : this.snapshot.activeSourceSession
      };
      this.emitSnapshot();

      return { ok: true, data: { hash: saveResult.data.hash, snapshot: this.snapshot } };
    });
  }

  /**
   * Adds a new service (from the "Add service" catalog) to a Compose
   * project's base file, optionally wiring depends_on + connection env vars
   * into any number of already-existing services. Writes go through the
   * same hash-checked atomic save as everything else that touches a compose
   * file on disk, then reload the project so the graph reflects the new
   * service immediately.
   */
  async addServiceToProject(projectId: string, input: AddServiceInput): Promise<AddServiceResult> {
    return this.withLock(async () => {
      const project = this.snapshot.projects.find((entry) => entry.id === projectId);
      if (!project || project.runtimeKind !== "compose" || project.access !== "editable") {
        return {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: "Project not found or is not an editable Compose project." }
        };
      }

      if (!isValidServiceName(input.serviceName)) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid service name - use lowercase letters, numbers, and . _ - only."
          }
        };
      }

      if (project.services.some((service) => service.name === input.serviceName)) {
        return {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: `A service named "${input.serviceName}" already exists in this project.` }
        };
      }

      const imageCheck = validateImageTag(input.image);
      if (!imageCheck.ok) {
        return { ok: false, error: { code: "VALIDATION_FAILED", message: imageCheck.detail } };
      }

      const knownServiceNames = new Set(project.services.map((service) => service.name));
      for (const connection of input.connectTo ?? []) {
        if (!knownServiceNames.has(connection.serviceName)) {
          return {
            ok: false,
            error: { code: "VALIDATION_FAILED", message: `Service "${connection.serviceName}" was not found in this project.` }
          };
        }
      }

      const mainPath = project.sourcePath ?? project.configFiles[0];
      if (!mainPath) {
        return { ok: false, error: { code: "VALIDATION_FAILED", message: "Project has no known source path." } };
      }

      const currentText = await readFile(mainPath, "utf8");
      const { sourceText: nextText } = addServiceToCompose(currentText, input);

      const saveResult = await saveSourceAtomically(mainPath, nextText, hashSource(currentText));
      if (!saveResult.ok) {
        return saveResult;
      }

      const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
      const reloaded = await loadComposeProject(mainPath, contextName, project.configFiles);
      if (project.allConfigFiles) {
        reloaded.allConfigFiles = project.allConfigFiles;
      }
      if (project.groupId) {
        reloaded.groupId = project.groupId;
        reloaded.groupLabel = project.groupLabel;
      }

      const runtimeProjects = this.snapshot.projects.filter((entry) => entry.access === "runtime-only");
      const sourceProjects = this.snapshot.projects.filter(
        (entry) => entry.access !== "runtime-only" && entry.id !== reloaded.id
      );
      const mergedProjects = mergeProjectLists(reloaded.contextName, [reloaded, ...sourceProjects], runtimeProjects);

      this.snapshot = {
        ...this.snapshot,
        projects: mergedProjects
      };
      this.emitSnapshot();

      return { ok: true, data: { snapshot: this.snapshot, serviceName: input.serviceName } };
    });
  }

  /**
   * Removes a service from a Compose project's base file - its own block,
   * any depends_on references to it in other services, and any named volume
   * it exclusively used. The renderer only ever sends a projectId + service
   * name; which file to edit and what to remove is resolved entirely here.
   */
  async removeServiceFromProject(projectId: string, serviceName: string): Promise<RemoveServiceResult> {
    return this.withLock(async () => {
      const project = this.snapshot.projects.find((entry) => entry.id === projectId);
      if (!project || project.runtimeKind !== "compose" || project.access !== "editable") {
        return {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: "Project not found or is not an editable Compose project." }
        };
      }

      if (!project.services.some((service) => service.name === serviceName)) {
        return {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: `Service "${serviceName}" was not found in this project.` }
        };
      }

      const mainPath = project.sourcePath ?? project.configFiles[0];
      if (!mainPath) {
        return { ok: false, error: { code: "VALIDATION_FAILED", message: "Project has no known source path." } };
      }

      const currentText = await readFile(mainPath, "utf8");
      const { sourceText: nextText } = removeServiceFromCompose(currentText, serviceName);

      const saveResult = await saveSourceAtomically(mainPath, nextText, hashSource(currentText));
      if (!saveResult.ok) {
        return saveResult;
      }

      const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
      const reloaded = await loadComposeProject(mainPath, contextName, project.configFiles);
      if (project.allConfigFiles) {
        reloaded.allConfigFiles = project.allConfigFiles;
      }
      if (project.groupId) {
        reloaded.groupId = project.groupId;
        reloaded.groupLabel = project.groupLabel;
      }

      const runtimeProjects = this.snapshot.projects.filter((entry) => entry.access === "runtime-only");
      const sourceProjects = this.snapshot.projects.filter(
        (entry) => entry.access !== "runtime-only" && entry.id !== reloaded.id
      );
      const mergedProjects = mergeProjectLists(reloaded.contextName, [reloaded, ...sourceProjects], runtimeProjects);

      this.snapshot = {
        ...this.snapshot,
        projects: mergedProjects
      };
      this.emitSnapshot();

      return { ok: true, data: { snapshot: this.snapshot, serviceName } };
    });
  }

  private resolveServiceEditContext(
    projectId: string,
    serviceName: string
  ): { project: ProjectSummary; mainPath: string } | { error: Extract<Result<unknown>, { ok: false }> } {
    const project = this.snapshot.projects.find((entry) => entry.id === projectId);
    if (!project || project.runtimeKind !== "compose" || project.access !== "editable") {
      return {
        error: {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: "Project not found or is not an editable Compose project." }
        }
      };
    }

    if (!project.services.some((service) => service.name === serviceName)) {
      return {
        error: {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: `Service "${serviceName}" was not found in this project.` }
        }
      };
    }

    const mainPath = project.sourcePath ?? project.configFiles[0];
    if (!mainPath) {
      return {
        error: { ok: false, error: { code: "VALIDATION_FAILED", message: "Project has no known source path." } }
      };
    }

    return { project, mainPath };
  }

  /**
   * Reads a service's graphical fields (image, restart, ports, volumes,
   * depends_on, environment) straight from the project's base compose file,
   * for the side-panel "Edit" tab. A service only declared in an override
   * file (not the base file) isn't readable here - the same base-file-only
   * scope addServiceToProject/removeServiceFromProject already have.
   */
  async getServiceFields(projectId: string, serviceName: string): Promise<GetServiceFieldsResult> {
    const context = this.resolveServiceEditContext(projectId, serviceName);
    if ("error" in context) {
      return context.error;
    }

    try {
      const sourceText = await readFile(context.mainPath, "utf8");
      const fields = readServiceFields(sourceText, serviceName);
      if (!fields) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: `Service "${serviceName}" isn't declared in ${context.mainPath} - it may only be defined in an override file, which this editor doesn't support yet.`
          }
        };
      }

      return { ok: true, data: { fields } };
    } catch (error) {
      return {
        ok: false,
        error: { code: "PROCESS_FAILED", message: error instanceof Error ? error.message : "Unable to read service fields." }
      };
    }
  }

  /**
   * Compares each running, compose-declared service's actual container state
   * against what the project's main compose file declares for it - same
   * base-file-only scope as getServiceFields, one file read shared across
   * every service rather than one read per service.
   */
  async getConfigDrift(projectId: string): Promise<ConfigDriftResult> {
    const project = this.snapshot.projects.find((entry) => entry.id === projectId);
    if (!project || project.runtimeKind !== "compose" || project.access !== "editable") {
      return { ok: true, data: { findings: [] } };
    }

    const mainPath = project.sourcePath ?? project.configFiles[0];
    if (!mainPath) {
      return { ok: true, data: { findings: [] } };
    }

    try {
      const sourceText = await readFile(mainPath, "utf8");
      const findings: DriftFinding[] = [];

      for (const service of project.services) {
        if (!service.details) {
          continue;
        }
        const fields = readServiceFields(sourceText, service.name);
        if (!fields) {
          continue;
        }
        findings.push(...detectServiceDrift(service.name, fields, service.details));
      }

      return { ok: true, data: { findings } };
    } catch (error) {
      return {
        ok: false,
        error: { code: "PROCESS_FAILED", message: error instanceof Error ? error.message : "Unable to check config drift." }
      };
    }
  }

  /**
   * Writes graphical field edits from the side panel back to the compose
   * file. Every field present in `fields` is fully replaced (add/remove-row
   * form semantics), then the project reloads so the graph reflects the
   * change immediately - the same hash-checked atomic save + reload
   * pipeline as every other compose mutation in this class.
   */
  async updateServiceFields(
    projectId: string,
    serviceName: string,
    fields: ServiceFieldsInput
  ): Promise<UpdateServiceFieldsResult> {
    return this.withLock(async () => {
      const context = this.resolveServiceEditContext(projectId, serviceName);
      if ("error" in context) {
        return context.error;
      }
      const { project, mainPath } = context;

      // Empty is valid here - it means "leave whatever's there alone" (see
      // applyServiceFieldEdits), which is the normal state for a build-based
      // service that never had an `image:` key to begin with.
      if (fields.image !== undefined && fields.image.trim() !== "") {
        const imageCheck = validateImageTag(fields.image);
        if (!imageCheck.ok) {
          return { ok: false, error: { code: "VALIDATION_FAILED", message: imageCheck.detail } };
        }
      }

      if (fields.restart !== undefined && fields.restart.trim() !== "" && !isValidRestartPolicy(fields.restart)) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: 'Invalid restart policy - use "no", "always", "unless-stopped", or "on-failure[:max-retries]".'
          }
        };
      }

      const currentText = await readFile(mainPath, "utf8");

      // Ground truth is the compose file being saved, not `this.snapshot`'s
      // cached project - that snapshot only refreshes on the next
      // docker-events-debounced sync, so a dependency target added moments
      // ago (e.g. via "Add service") could still look "unknown" here and
      // block the save even though it's right there in the file.
      const knownServiceNames = listServiceNames(currentText);
      for (const dependency of fields.dependsOn ?? []) {
        if (dependency === serviceName) {
          return {
            ok: false,
            error: { code: "VALIDATION_FAILED", message: "A service cannot depend on itself." }
          };
        }
        if (!knownServiceNames.has(dependency)) {
          return {
            ok: false,
            error: { code: "VALIDATION_FAILED", message: `Service "${dependency}" was not found in this project.` }
          };
        }
      }

      const { sourceText: nextText } = applyServiceFieldEdits(currentText, serviceName, fields);

      const saveResult = await saveSourceAtomically(mainPath, nextText, hashSource(currentText));
      if (!saveResult.ok) {
        return saveResult;
      }

      const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
      const reloaded = await loadComposeProject(mainPath, contextName, project.configFiles);
      if (project.allConfigFiles) {
        reloaded.allConfigFiles = project.allConfigFiles;
      }
      if (project.groupId) {
        reloaded.groupId = project.groupId;
        reloaded.groupLabel = project.groupLabel;
      }

      const runtimeProjects = this.snapshot.projects.filter((entry) => entry.access === "runtime-only");
      const sourceProjects = this.snapshot.projects.filter(
        (entry) => entry.access !== "runtime-only" && entry.id !== reloaded.id
      );
      const mergedProjects = mergeProjectLists(reloaded.contextName, [reloaded, ...sourceProjects], runtimeProjects);

      this.snapshot = {
        ...this.snapshot,
        projects: mergedProjects
      };
      this.emitSnapshot();

      return { ok: true, data: { snapshot: this.snapshot } };
    });
  }

  // Shared tail end of every "mutate the base compose file, then reload"
  // operation: hash-checked atomic save, reload the project, merge it back
  // into the snapshot, and emit. Callers own their own validation and must
  // already be inside withLock - this only exists to stop that reload/merge
  // boilerplate from growing a sixth near-identical copy (see
  // addServiceToProject/removeServiceFromProject/updateServiceFields above).
  private async applyComposeMutationAndReload(
    project: ProjectSummary,
    mainPath: string,
    mutate: (sourceText: string) => string
  ): Promise<SnapshotMutationResult> {
    const currentText = await readFile(mainPath, "utf8");
    const nextText = mutate(currentText);

    const saveResult = await saveSourceAtomically(mainPath, nextText, hashSource(currentText));
    if (!saveResult.ok) {
      return saveResult;
    }

    const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
    const reloaded = await loadComposeProject(mainPath, contextName, project.configFiles);
    if (project.allConfigFiles) {
      reloaded.allConfigFiles = project.allConfigFiles;
    }
    if (project.groupId) {
      reloaded.groupId = project.groupId;
      reloaded.groupLabel = project.groupLabel;
    }

    const runtimeProjects = this.snapshot.projects.filter((entry) => entry.access === "runtime-only");
    const sourceProjects = this.snapshot.projects.filter(
      (entry) => entry.access !== "runtime-only" && entry.id !== reloaded.id
    );
    const mergedProjects = mergeProjectLists(reloaded.contextName, [reloaded, ...sourceProjects], runtimeProjects);

    this.snapshot = {
      ...this.snapshot,
      projects: mergedProjects
    };
    this.emitSnapshot();

    return { ok: true, data: { snapshot: this.snapshot } };
  }

  /** Click-to-disconnect for a depends_on edge in the graph view. */
  async disconnectDependency(projectId: string, fromService: string, toService: string): Promise<SnapshotMutationResult> {
    return this.withLock(async () => {
      const context = this.resolveServiceEditContext(projectId, fromService);
      if ("error" in context) {
        return context.error;
      }

      return this.applyComposeMutationAndReload(
        context.project,
        context.mainPath,
        (text) => removeDependencyEdge(text, fromService, toService).sourceText
      );
    });
  }

  /** Click-to-disconnect for a volume-mount edge in the graph view. */
  async disconnectVolumeMount(projectId: string, serviceName: string, volumeName: string): Promise<SnapshotMutationResult> {
    return this.withLock(async () => {
      const context = this.resolveServiceEditContext(projectId, serviceName);
      if ("error" in context) {
        return context.error;
      }

      return this.applyComposeMutationAndReload(
        context.project,
        context.mainPath,
        (text) => removeVolumeMount(text, serviceName, volumeName).sourceText
      );
    });
  }

  async getServiceLogs(containerId: string, tail: number): Promise<LogSnapshotResult> {
    if (!isValidContainerRef(containerId)) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Invalid container id." }
      };
    }

    try {
      return {
        ok: true,
        data: await fetchContainerLogs(containerId, normalizeLogTail(tail))
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: isTimeoutError(error) ? "TIMEOUT" : "PROCESS_FAILED",
          message: error instanceof Error ? error.message : "Unable to fetch container logs."
        }
      };
    }
  }

  async getServiceStats(containerId: string): Promise<StatsSnapshotResult> {
    if (!isValidContainerRef(containerId)) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Invalid container id." }
      };
    }

    try {
      return {
        ok: true,
        data: await fetchContainerStats(containerId)
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: isTimeoutError(error) ? "TIMEOUT" : "PROCESS_FAILED",
          message: error instanceof Error ? error.message : "Unable to fetch container stats."
        }
      };
    }
  }

  /**
   * Runs a project action (validate/apply-start/stop/build-image) end to end:
   * resolves the project purely from the id (the renderer never sends a raw
   * path or command fragment), refuses to double-run on the same project,
   * streams progress via `onEvent`, then folds the outcome into the snapshot
   * and - for anything that can change container state - synchronizes runtime
   * so the graph reflects it.
   */
  async runProjectAction(
    projectId: string,
    actionId: string,
    onEvent: (event: OperationEvent) => void
  ): Promise<ProjectActionResult> {
    if (typeof projectId !== "string" || projectId.trim() === "") {
      return { ok: false, error: { code: "VALIDATION_FAILED", message: "No project id was provided." } };
    }

    if (!isExecutableActionId(actionId)) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: `Action "${actionId}" cannot be run as an operation.` }
      };
    }

    const project = this.snapshot.projects.find((entry) => entry.id === projectId);
    if (!project) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "That project is no longer available. Reopen it and try again." }
      };
    }

    if (!project.actions.some((action) => action.id === actionId)) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: `This project does not support the "${actionId}" action.` }
      };
    }

    if (this.activeOperations.has(projectId)) {
      return {
        ok: false,
        error: { code: "OPERATION_IN_PROGRESS", message: "An operation is already in progress for this project." }
      };
    }

    const controller = new AbortController();
    this.activeOperations.set(projectId, { actionId, controller });
    const operationId = randomUUID();
    const startedAt = new Date().toISOString();

    onEvent({ kind: "status", projectId, operationId, actionId, status: "running", startedAt });

    try {
      const outcome = await executeProjectAction(
        project,
        actionId,
        (stream, line) => {
          onEvent({ kind: "output", projectId, operationId, actionId, stream, line });
        },
        controller.signal
      );

      let snapshot = await this.finalizeOperation(projectId, actionId, outcome);
      if (actionId !== "validate") {
        // Container state changed (or was attempted to change) - pull fresh
        // runtime data so the graph/status dots reflect it immediately.
        snapshot = await this.synchronizeSnapshot();
      }

      onEvent({
        kind: "status",
        projectId,
        operationId,
        actionId,
        status: outcome.ok ? "success" : "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        errorMessage: outcome.ok ? undefined : outcome.detail
      });

      return { ok: true, data: { operationId, outcome, snapshot } };
    } catch (error) {
      // cancelProjectAction aborts `controller` directly - by the time the
      // killed process's promise rejects here, `signal.aborted` is the only
      // reliable way to tell "the user cancelled this" apart from any other
      // process failure (a plain kill doesn't come back as a timeout error).
      const cancelled = controller.signal.aborted;
      const message = cancelled
        ? "Operation cancelled."
        : error instanceof Error
          ? error.message
          : "The operation failed unexpectedly.";

      onEvent({
        kind: "status",
        projectId,
        operationId,
        actionId,
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        errorMessage: message
      });

      return {
        ok: false,
        error: { code: cancelled ? "CANCELLED" : isTimeoutError(error) ? "TIMEOUT" : "PROCESS_FAILED", message }
      };
    } finally {
      this.activeOperations.delete(projectId);
    }
  }

  /**
   * Aborts whatever operation is currently running for `projectId` (if any).
   * The in-flight `runProjectAction` call observes the same AbortController
   * and handles its own cleanup/status event once the killed process's
   * promise settles - this just triggers that.
   */
  async cancelProjectAction(projectId: string): Promise<CancelActionResult> {
    const active = this.activeOperations.get(projectId);
    if (!active) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "No operation is currently running for this project." }
      };
    }

    active.controller.abort();
    return { ok: true, data: { cancelled: true } };
  }

  private async finalizeOperation(
    projectId: string,
    actionId: ExecutableProjectActionId,
    outcome: ValidationOutcome
  ): Promise<AppSnapshot> {
    return this.withLock(async () => {
      const diagnostic: ProjectDiagnostics = {
        level: outcome.ok ? "info" : "error",
        title: outcome.title,
        message: outcome.detail
      };

      this.snapshot = {
        ...this.snapshot,
        projects: this.snapshot.projects.map((project) =>
          project.id === projectId
            ? {
                ...project,
                // Replace any previous diagnostic with the same title instead
                // of letting repeated clicks pile up duplicate entries.
                diagnostics: [diagnostic, ...project.diagnostics.filter((entry) => entry.title !== diagnostic.title)],
                buildStatus:
                  outcome.ok && (actionId === "validate" || actionId === "build-image" || actionId === "apply-start")
                    ? "built"
                    : project.buildStatus
              }
            : project
        )
      };
      this.emitSnapshot();

      return this.snapshot;
    });
  }

  async updateSettings(settings: Partial<AppSettings>): Promise<AppSnapshot> {
    return this.withLock(async () => {
      this.snapshot = {
        ...this.snapshot,
        settings: {
          ...this.snapshot.settings,
          ...sanitizeSettingsPatch(settings)
        }
      };
      this.emitSnapshot();

      return this.snapshot;
    });
  }

  async clearRecents(): Promise<AppSnapshot> {
    return this.withLock(async () => {
      this.snapshot = {
        ...this.snapshot,
        recents: []
      };
      this.emitSnapshot();

      return this.snapshot;
    });
  }
}
