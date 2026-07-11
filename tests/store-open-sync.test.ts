import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../src/renderer/store";
import type { AppSnapshot, ProjectSummary } from "../src/shared/contracts";

function project(id: string, title: string, overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id,
    title,
    subtitle: "Explicitly opened Compose source",
    runtimeKind: "compose",
    access: "editable",
    contextName: "desktop-linux",
    sourcePath: `C:\\projects\\demo\\${title}`,
    configFiles: [`C:\\projects\\demo\\${title}`],
    services: [],
    diagnostics: [],
    actions: [{ id: "validate", label: "Validate" }],
    lastUpdatedLabel: "Opened from source",
    externalNodes: [],
    relationshipEdges: [],
    sourceLinked: true,
    ...overrides
  };
}

function baseSnapshot(projects: ProjectSummary[], activeProjectId: string | undefined): AppSnapshot {
  return {
    dockerStatus: {
      cliAvailable: true,
      daemonAvailable: true,
      composeAvailable: true,
      buildxAvailable: true,
      message: "ok"
    },
    projects,
    recents: [],
    activeProjectId,
    settings: {
      themeMode: "dark",
      runtimeRefreshSeconds: 3,
      statsPollSeconds: 3,
      logTailLines: 200
    }
  };
}

describe("openSourcePath snapshot sync", () => {
  beforeEach(() => {
    useAppStore.setState({
      snapshot: null,
      loading: false,
      theme: "dark",
      error: undefined,
      recentLoadingPath: undefined,
      operations: {},
      selectedProjectId: undefined
    });
  });

  it("picks up sibling projects committed on the main side, not just the one returned by openSourcePath", async () => {
    const auth = project("a", "docker-compose-auth.yml", { groupId: "C:\\projects\\demo", groupLabel: "demo" });
    const payment = project("b", "docker-compose-payment.yml", { groupId: "C:\\projects\\demo", groupLabel: "demo" });

    window.dockerExplorer = {
      openSourcePath: vi.fn().mockResolvedValue({ ok: true, data: auth }),
      getSnapshot: vi.fn().mockResolvedValue(baseSnapshot([auth, payment], auth.id))
    } as never;

    const ok = await useAppStore.getState().openSourcePath(auth.sourcePath ?? "");
    expect(ok).toBe(true);

    const { snapshot, selectedProjectId, loading } = useAppStore.getState();
    expect(snapshot?.projects.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(selectedProjectId).toBe("a");
    expect(loading).toBe(false);
  });

  it("sets selectedProjectId so the opened project (not a stale prior selection) becomes active", async () => {
    const previouslySelected = project("old", "docker-compose.yml");
    const justOpened = project("new", "docker-compose.yml");

    useAppStore.setState({
      snapshot: baseSnapshot([previouslySelected], previouslySelected.id),
      selectedProjectId: previouslySelected.id
    });

    window.dockerExplorer = {
      openSourcePath: vi.fn().mockResolvedValue({ ok: true, data: justOpened }),
      getSnapshot: vi.fn().mockResolvedValue(baseSnapshot([justOpened, previouslySelected], justOpened.id))
    } as never;

    await useAppStore.getState().openSourcePath(justOpened.sourcePath ?? "");

    expect(useAppStore.getState().selectedProjectId).toBe("new");
  });
});
