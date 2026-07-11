import { dialog } from "electron";
import { access, readFile } from "node:fs/promises";
import type {
  AppSettings,
  AppSnapshot,
  LogSnapshotResult,
  OpenSourceResult,
  ProjectSummary
} from "../shared/contracts";
import { fetchContainerLogs, detectDockerStatus, discoverRuntimeProjects } from "./docker-service";
import { hashSource, loadComposeProject } from "./compose-service";
import { loadDockerfileProject } from "./dockerfile-service";

const DEFAULT_SETTINGS: AppSettings = {
  themeMode: "dark",
  runtimeRefreshSeconds: 3,
  statsPollSeconds: 3,
  logTailLines: 200
};

export class ProjectService {
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

  async getSnapshot(): Promise<AppSnapshot> {
    return this.snapshot;
  }

  async refreshRuntime(): Promise<AppSnapshot> {
    try {
      const dockerStatus = await detectDockerStatus();
      const runtimeProjects = await discoverRuntimeProjects(dockerStatus);
      const sourceProjects = this.snapshot.projects.filter((project) => project.access !== "runtime-only");
      const projects = [...sourceProjects, ...runtimeProjects];
      const derivedRecents = [
        ...this.snapshot.recents,
        ...sourceProjects.map((project) => project.sourcePath).filter((entry): entry is string => Boolean(entry)),
        ...runtimeProjects.flatMap((project) => project.configFiles)
      ]
        .filter(Boolean)
        .filter((entry, index, all) => all.indexOf(entry) === index)
        .slice(0, 12);

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

      return this.snapshot;
    } catch {
      this.snapshot = {
        ...this.snapshot,
        dockerStatus: {
          cliAvailable: false,
          daemonAvailable: false,
          composeAvailable: false,
          buildxAvailable: false,
          contextName: this.snapshot.dockerStatus.contextName,
          message: "Docker status could not be refreshed right now.",
          checkedAt: new Date().toISOString()
        },
        projects: this.snapshot.projects.filter((project) => project.access !== "runtime-only"),
        activeProjectId: this.snapshot.activeProjectId
      };

      return this.snapshot;
    }
  }

  private async loadProjectFromPath(sourcePath: string): Promise<ProjectSummary> {
    const contextName = this.snapshot.dockerStatus.contextName ?? "unknown-context";
    return /(^|[\\/])dockerfile$/i.test(sourcePath)
      ? loadDockerfileProject(sourcePath, contextName)
      : loadComposeProject(sourcePath, contextName);
  }

  private async commitOpenedProject(sourcePath: string, project: ProjectSummary): Promise<OpenSourceResult> {
    const sourceText = await readFile(sourcePath, "utf8");

    this.snapshot = {
      ...this.snapshot,
      projects: [project, ...this.snapshot.projects.filter((entry) => entry.id !== project.id)],
      recents: [sourcePath, ...this.snapshot.recents.filter((entry) => entry !== sourcePath)].slice(0, 12),
      activeProjectId: project.id,
      activeSourceSession: {
        id: project.id,
        sourcePath,
        revision: 1,
        lastKnownHash: hashSource(sourceText),
        diffPreview: "No pending changes"
      }
    };

    return {
      ok: true,
      data: project
    };
  }

  async openSource(): Promise<OpenSourceResult> {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"]
    });

    const sourcePath = result.filePaths[0];
    if (!sourcePath) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "No file was selected."
        }
      };
    }

    return this.openSourcePath(sourcePath);
  }

  async openSourcePath(sourcePath: string): Promise<OpenSourceResult> {
    try {
      await access(sourcePath);
      const project = await this.loadProjectFromPath(sourcePath);
      return this.commitOpenedProject(sourcePath, project);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: error instanceof Error ? error.message : "Unable to open the selected file."
        }
      };
    }
  }

  async openRecentSource(sourcePath: string): Promise<OpenSourceResult> {
    return this.openSourcePath(sourcePath);
  }

  async getServiceLogs(containerId: string, tail: number): Promise<LogSnapshotResult> {
    try {
      return {
        ok: true,
        data: await fetchContainerLogs(containerId, tail)
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "PROCESS_FAILED",
          message: error instanceof Error ? error.message : "Unable to fetch container logs."
        }
      };
    }
  }

  async updateSettings(settings: Partial<AppSettings>): Promise<AppSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      settings: {
        ...this.snapshot.settings,
        ...settings
      }
    };

    return this.snapshot;
  }

  async clearRecents(): Promise<AppSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      recents: []
    };

    return this.snapshot;
  }
}
