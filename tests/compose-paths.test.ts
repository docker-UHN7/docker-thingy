import { describe, expect, it } from "vitest";
import { describeComposePath } from "../src/main/compose-service";

describe("describeComposePath", () => {
  it("allows relative paths with dot-dot segments", () => {
    expect(describeComposePath("../backend.Dockerfile")).toEqual([]);
  });

  it("warns on absolute paths", () => {
    const diagnostics = describeComposePath("/opt/projects/shared");
    expect(diagnostics[0]?.level).toBe("warning");
  });
});

