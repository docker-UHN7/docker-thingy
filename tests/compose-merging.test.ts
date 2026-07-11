import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadComposeProject } from "../src/main/compose-service";

const fixturesDir = join(process.cwd(), "tests", "fixtures");
const basePath = join(fixturesDir, "compose-merge-base.yaml");
const overridePath = join(fixturesDir, "compose-merge-override.yaml");

describe("loadComposeProject multi-file merging", () => {
  it("loads only the base file's services when no override is selected", async () => {
    const project = await loadComposeProject(basePath, "desktop-linux");

    expect(project.services.map((service) => service.name).sort()).toEqual(["api", "web"]);
    expect(project.configFiles).toEqual([basePath]);
  });

  it("merges a later file's services into the base file's services", async () => {
    const project = await loadComposeProject(basePath, "desktop-linux", [basePath, overridePath]);

    expect(project.services.map((service) => service.name).sort()).toEqual(["api", "db", "web"]);
    expect(project.configFiles).toEqual([basePath, overridePath]);
  });

  it("lets a later file override an earlier file's image", async () => {
    const project = await loadComposeProject(basePath, "desktop-linux", [basePath, overridePath]);
    const web = project.services.find((service) => service.name === "web");

    expect(web?.image).toBe("nginx:1.25");
  });

  it("combines (rather than replaces) port mappings declared across files", async () => {
    const project = await loadComposeProject(basePath, "desktop-linux", [basePath, overridePath]);
    const web = project.services.find((service) => service.name === "web");

    expect(web?.portMappings.some((port) => port.label === "8080 -> 80/tcp")).toBe(true);
    expect(web?.portMappings.some((port) => port.label === "9090 -> 80/tcp")).toBe(true);
  });

  it("unions declared networks across files instead of dropping the base's", () => {
    return loadComposeProject(basePath, "desktop-linux", [basePath, overridePath]).then((project) => {
      const web = project.services.find((service) => service.name === "web");
      expect(web?.declaredNetworks.sort()).toEqual(["backend", "frontend"]);
    });
  });

  it("keeps a service's base depends_on when the override doesn't redeclare it", async () => {
    const project = await loadComposeProject(basePath, "desktop-linux", [basePath, overridePath]);
    const web = project.services.find((service) => service.name === "web");

    expect(web?.dependencyDetails).toEqual([{ serviceName: "api" }]);
  });

  it("merges dependency rules introduced by a new service in a later file", async () => {
    const project = await loadComposeProject(basePath, "desktop-linux", [basePath, overridePath]);
    const db = project.services.find((service) => service.name === "db");

    expect(db?.dependencyDetails).toEqual([{ serviceName: "api" }]);
  });
});
