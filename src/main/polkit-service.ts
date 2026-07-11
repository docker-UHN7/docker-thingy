import { PROCESS_LIMITS, execCommand } from "./process-runner";

// Polkit authentication agents don't register under one well-known D-Bus
// name, so there's no clean API to ask polkitd "is one running" - this is
// the same process-name heuristic most Linux desktop tooling falls back to
// for the same reason (GNOME/KDE/XFCE ship one; Hyprland and other minimal
// WMs don't, which is exactly the gap this is here to catch). A false
// negative here just means a slightly-too-cautious banner; without an agent,
// pkexec has no way to prompt at all (there's no controlling TTY when it's
// spawned from Electron's main process), so it would otherwise fail with a
// much less helpful raw pkexec error.
// Covers both spellings vendors actually use for the binary name - e.g.
// LXQt's is "lxqt-policykit-agent" ("policykit", not "polkit").
const KNOWN_AGENT_PATTERN = /(polkit|policykit).*agent|agent.*(polkit|policykit)/i;

export function hasKnownPolkitAgent(processListText: string): boolean {
  return processListText.split(/\r?\n/).some((line) => KNOWN_AGENT_PATTERN.test(line));
}

export async function isPolkitAgentRunning(): Promise<boolean> {
  try {
    // args= (full command line), not comm= - comm truncates to ~15 chars,
    // which cuts off names like "polkit-gnome-authentication-agent-1" before
    // the pattern above would ever match.
    const result = await execCommand("ps", ["-eo", "args="], {
      timeoutMs: PROCESS_LIMITS.capabilityCheckMs,
      maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
      category: "capability-check"
    });

    return hasKnownPolkitAgent(result.stdout);
  } catch {
    return false;
  }
}
