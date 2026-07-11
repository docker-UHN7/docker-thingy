import { describe, expect, it } from "vitest";
import { hasKnownPolkitAgent } from "../src/main/polkit-service";

describe("hasKnownPolkitAgent", () => {
  it("detects common agent binaries by full command line", () => {
    expect(hasKnownPolkitAgent("/usr/lib/polkit-gnome/polkit-gnome-authentication-agent-1")).toBe(true);
    expect(hasKnownPolkitAgent("/usr/lib/x86_64-linux-gnu/hyprpolkitagent")).toBe(true);
    expect(hasKnownPolkitAgent("/usr/bin/lxqt-policykit-agent")).toBe(true);
  });

  it("matches within a full process list, one entry per line", () => {
    const psOutput = ["/usr/bin/bash", "/usr/bin/Hyprland", "/usr/lib/polkit-kde-authentication-agent-1", "node server.js"].join(
      "\n"
    );
    expect(hasKnownPolkitAgent(psOutput)).toBe(true);
  });

  it("returns false when no agent-like process is present", () => {
    const psOutput = ["/usr/bin/bash", "/usr/bin/Hyprland", "/usr/bin/waybar", "node server.js"].join("\n");
    expect(hasKnownPolkitAgent(psOutput)).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(hasKnownPolkitAgent("")).toBe(false);
  });
});
