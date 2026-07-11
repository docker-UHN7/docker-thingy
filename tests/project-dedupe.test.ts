import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfigKey } from "../src/main/docker-service";
import { mergeProjectLists } from "../src/main/project-service";
import type { ProjectSummary } from "../src/shared/contracts";

function sourceProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "source-compose:desktop-linux:C:\\projects\\panmettan\\docker-compose.yml",
    title: "docker-compose.yml",
    subtitle: "Explicitly opened Compose source",
    runtimeKind: "compose",
    access: "editable",
    contextName: "desktop-linux",
    sourcePath: "C:\\projects\\panmettan\\docker-compose.yml",
    configFiles: ["C:\\projects\\panmettan\\docker-compose.yml"],
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

function runtimeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "runtime-compose:desktop-linux:panmettan:key",
    title: "panmettan",
    subtitle: "running(2)",
    runtimeKind: "compose",
    access: "runtime-only",
    contextName: "desktop-linux",
    sourcePath: undefined,
    configFiles: ["C:\\projects\\panmettan\\docker-compose.yml"],
    services: [],
    diagnostics: [],
    actions: [],
    buildStatus: "built",
    lastUpdatedLabel: "Live runtime",
    externalNodes: [],
    relationshipEdges: [],
    sourceLinked: false,
    ...overrides
  };
}

describe("resolveConfigKey", () => {
  it("normalizes slash direction and case so the same file compares equal", () => {
    const a = resolveConfigKey("C:\\projects\\panmettan\\docker-compose.yml");
    const b = resolveConfigKey("c:/projects/PANMETTAN/docker-compose.yml");
    expect(a).toBe(b);
  });

  it("treats different directories with the same file basename as distinct", () => {
    const a = resolveConfigKey(join("projects", "panmettan", "docker-compose.yml"));
    const b = resolveConfigKey(join("projects", "other-project", "docker-compose.yml"));
    expect(a).not.toBe(b);
  });
});

describe("mergeProjectLists", () => {
  it("merges a source-opened project with its runtime-discovered twin into a single card, keeping the source id", () => {
    const source = sourceProject();
    const runtime = runtimeProject();

    const merged = mergeProjectLists("desktop-linux", [source], [runtime]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(source.id);
    expect(merged[0]?.access).toBe("editable");
    // Runtime-only info (status/subtitle) still comes through the merge.
    expect(merged[0]?.subtitle).toBe(runtime.subtitle);
  });

  it("keeps unrelated source and runtime projects as separate cards", () => {
    const source = sourceProject({
      id: "source-compose:desktop-linux:C:\\projects\\panmettan\\docker-compose.yml",
      sourcePath: "C:\\projects\\panmettan\\docker-compose.yml"
    });
    const unrelatedRuntime = runtimeProject({
      id: "runtime-compose:desktop-linux:other-project:key2",
      title: "other-project",
      configFiles: ["C:\\projects\\other-project\\docker-compose.yml"]
    });

    const merged = mergeProjectLists("desktop-linux", [source], [unrelatedRuntime]);

    expect(merged).toHaveLength(2);
    expect(merged.map((project) => project.id).sort()).toEqual([source.id, unrelatedRuntime.id].sort());
  });

  it("preserves source project order/identity so the active project never has to fall back to an unrelated card", () => {
    // Regression guard for the bug where every project (all named
    // docker-compose.yml) collapsed to whichever was projects[0] once its
    // runtime-discovered twin disappeared from `docker compose ls` mid
    // apply/stop. With the merge, the source card - and its stable id -
    // stays present regardless of whether a runtime twin exists this tick.
    const panmettan = sourceProject({
      id: "source-compose:desktop-linux:C:\\projects\\panmettan\\docker-compose.yml",
      sourcePath: "C:\\projects\\panmettan\\docker-compose.yml"
    });
    const otherProject = sourceProject({
      id: "source-compose:desktop-linux:C:\\projects\\other\\docker-compose.yml",
      sourcePath: "C:\\projects\\other\\docker-compose.yml"
    });

    // Simulate panmettan's runtime twin having momentarily dropped out of
    // `docker compose ls` (e.g. mid restart) - only otherProject appears in
    // the freshly discovered runtime list.
    const merged = mergeProjectLists("desktop-linux", [panmettan, otherProject], []);

    expect(merged.map((project) => project.id)).toEqual([panmettan.id, otherProject.id]);
    expect(merged.some((project) => project.id === panmettan.id)).toBe(true);
  });
});
