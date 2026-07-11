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
    buildStatus: "not-built",
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
      statsPollSeconds: 3,
      logTailLines: 200
    }
  };
}

describe("opening a source and syncing sibling projects", () => {
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

  it("sets selectedProjectId to the just-opened project immediately, not a stale prior selection", async () => {
    const previouslySelected = project("old", "docker-compose.yml");
    const justOpened = project("new", "docker-compose.yml");

    useAppStore.setState({
      snapshot: baseSnapshot([previouslySelected], previouslySelected.id),
      selectedProjectId: previouslySelected.id
    });

    window.dockerExplorer = {
      openSourcePath: vi.fn().mockResolvedValue({ ok: true, data: justOpened })
    } as never;

    await useAppStore.getState().openSourcePath(justOpened.sourcePath ?? "");

    expect(useAppStore.getState().selectedProjectId).toBe("new");
  });

  // Main commits every sibling project from a folder scan (see project.groupId)
  // in one shot and then pushes the authoritative snapshot over
  // subscribeSnapshotEvents - applySnapshot is what the renderer runs when
  // that push arrives. This is what makes sibling projects (and their tab
  // strip / group card) show up without the user having to wait for a
  // separate refresh.
  it("applySnapshot picks up sibling projects pushed from main without losing the current selection", () => {
    const auth = project("a", "docker-compose-auth.yml", { groupId: "C:\\projects\\demo", groupLabel: "demo" });
    const payment = project("b", "docker-compose-payment.yml", { groupId: "C:\\projects\\demo", groupLabel: "demo" });

    useAppStore.setState({
      snapshot: baseSnapshot([auth], auth.id),
      selectedProjectId: auth.id
    });

    useAppStore.getState().applySnapshot(baseSnapshot([auth, payment], auth.id));

    const { snapshot, selectedProjectId } = useAppStore.getState();
    expect(snapshot?.projects.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(selectedProjectId).toBe("a");
  });
});
