import type { NetworkActionRequest, NetworkActionResult, NetworkActionVerb } from "../shared/network-contracts";
import { PROCESS_LIMITS, execCommand, isTimeoutError } from "./process-runner";
import { applyOptimisticEdgeState, getNetworkTopology } from "./topology-service";
import { isPolkitAgentRunning } from "./polkit-service";
import { isValidContainerRef, isValidInterfaceName, isValidLibvirtDomainName, isValidMacAddress, isValidPid } from "./validation";

// The only privileged entry point this feature uses. Everything it can do is
// documented in resources/linux/docker-thingy-netctl, which re-validates
// every argument itself (defense in depth - anything that can invoke pkexec
// reaches that script directly, independent of this file).
const NETCTL_HELPER_PATH = "/usr/local/libexec/docker-thingy/netctl";

// VM link-state toggling needs no helper/pkexec at all: libvirtd's own
// group-based authorization already covers `domif-setlink` for members of
// the libvirt group, so this goes straight through virsh.
const LIBVIRT_URI = "qemu:///system";

/**
 * pkexec, spawned from Electron's main process, has no controlling terminal
 * to fall back to for a text-mode prompt - without a real polkit
 * authentication agent registered (GNOME/KDE/XFCE ship one; Hyprland and
 * other minimal WMs typically don't), it can only fail. Checking first turns
 * that into a clear, actionable error instead of an opaque pkexec failure.
 */
async function runPkexecHelper(args: readonly string[]): Promise<void> {
  if (!(await isPolkitAgentRunning())) {
    throw new Error(
      "No polkit authentication agent is running, so the system can't prompt for authorization. " +
        "Install one for your desktop (e.g. hyprpolkitagent on Hyprland, or polkit-gnome/polkit-kde/xfce-polkit " +
        "elsewhere), then try again."
    );
  }

  await execCommand("pkexec", [NETCTL_HELPER_PATH, ...args], {
    timeoutMs: PROCESS_LIMITS.networkControlMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "network-control"
  });
}

async function resolveContainerPid(containerId: string): Promise<string> {
  const result = await execCommand("docker", ["inspect", "--format", "{{.State.Pid}}", containerId], {
    timeoutMs: PROCESS_LIMITS.capabilityCheckMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "capability-check"
  });

  const pid = result.stdout.trim();
  if (!isValidPid(pid) || pid === "0") {
    throw new Error(`Could not resolve a running process for container ${containerId}.`);
  }

  return pid;
}

async function setContainerLink(containerId: string, state: "up" | "down"): Promise<void> {
  if (!isValidContainerRef(containerId)) {
    throw new Error("Invalid container id.");
  }

  const pid = await resolveContainerPid(containerId);
  await runPkexecHelper(["container-link", pid, state]);
}

async function setBridgeForwarding(bridgeName: string, state: "up" | "down"): Promise<void> {
  if (!isValidInterfaceName(bridgeName)) {
    throw new Error("Invalid bridge name.");
  }

  await runPkexecHelper(["bridge-forward", bridgeName, state === "up" ? "allow" : "deny"]);
}

async function setVmLink(domain: string, mac: string, state: "up" | "down"): Promise<void> {
  if (!isValidLibvirtDomainName(domain)) {
    throw new Error("Invalid domain name.");
  }
  if (!isValidMacAddress(mac)) {
    throw new Error("Invalid MAC address.");
  }

  await execCommand("virsh", ["-c", LIBVIRT_URI, "domif-setlink", domain, mac, state], {
    timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "runtime-discovery"
  });
}

export function parseVmLinkTargetId(targetId: string): { domain: string; mac: string } {
  const separatorIndex = targetId.lastIndexOf("|");
  if (separatorIndex === -1) {
    throw new Error("Malformed vm-link target id.");
  }

  return {
    domain: targetId.slice(0, separatorIndex),
    mac: targetId.slice(separatorIndex + 1)
  };
}

async function executeVerb(verb: NetworkActionVerb, targetId: string, state: "up" | "down"): Promise<void> {
  switch (verb) {
    case "container-link":
      return setContainerLink(targetId, state);
    case "bridge-forward":
      return setBridgeForwarding(targetId, state);
    case "vm-link": {
      const { domain, mac } = parseVmLinkTargetId(targetId);
      return setVmLink(domain, mac, state);
    }
    default: {
      const exhaustiveCheck: never = verb;
      throw new Error(`Unsupported verb: ${String(exhaustiveCheck)}`);
    }
  }
}

export async function runNetworkAction(request: NetworkActionRequest): Promise<NetworkActionResult> {
  try {
    await executeVerb(request.verb, request.targetId, request.state);

    const freshTopology = await getNetworkTopology();
    const topology = applyOptimisticEdgeState(freshTopology, request.verb, request.targetId, request.state);

    return { ok: true, data: { topology } };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: isTimeoutError(error) ? "TIMEOUT" : "PROCESS_FAILED",
        message: error instanceof Error ? error.message : "The network action failed unexpectedly."
      }
    };
  }
}
