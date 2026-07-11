import { describe, expect, it } from "vitest";
import { groupContainersByComposeProject } from "../src/main/docker-service";

describe("groupContainersByComposeProject", () => {
  it("creates context-aware grouping keys", () => {
    const grouped = groupContainersByComposeProject("desktop-linux", [
      {
        id: "abc",
        shortId: "abc",
        name: "demo-web-1",
        serviceName: "web",
        image: "nginx",
        status: "running",
        running: true
      }
    ]);

    expect(Object.keys(grouped)).toEqual(["runtime-compose:desktop-linux:web"]);
  });
});

