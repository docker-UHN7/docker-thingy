import { describe, expect, it } from "vitest";
import { updateComposeImage } from "../src/main/compose-service";

describe("updateComposeImage", () => {
  it("updates a scalar image value while producing a diff preview", () => {
    const source = `services:\n  api:\n    image: old:tag\n`;
    const result = updateComposeImage(source, "api", "new:tag");

    expect(result.sourceText).toContain("new:tag");
    expect(result.diffPreview).toContain("+ image: new:tag");
  });
});

