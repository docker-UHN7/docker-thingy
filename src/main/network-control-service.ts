import * as z from "zod";
import { ContainerInspectSchema } from "../shared/contracts";
import type { NetworkActionRequest, NetworkActionResult } from "../shared/network-contracts";
import { PROCESS_LIMITS, execCommand, isTimeoutError } from "./process-runner";
import { getNetworkTopology } from "./topology-service";
import { isPolkitAgentRunning } from "./polkit-service";
import { dockerNetworkBridgeName, listDockerNetworks, toContainerDetails } from "./docker-service";
import { isValidContainerRef, isValidInterfaceName, isValidLibvirtDomainName, isValidMacAddress, isValidPid } from "./validation";

// The only privileged entry point this feature uses. Everything it can do is
// documented in resources/linux/docker-thingy-netctl, which re-validates
// every argument itself (defense in depth - anything that can invoke pkexec
// reaches that script directly, independent of this file).
const NETCTL_HELPER_PATH = "/usr/local/libexec/docker-thingy/netctl";

// VM link-state toggling and reattach need no helper/pkexec at all:
// libvirtd's own group-based authorization already covers these calls for
// members of the libvirt group, so they go straight through virsh.
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

export function parseContainerLinkTargetId(targetId: string): { containerId: string; mac: string | undefined } {
  const { id, mac } = parseIdMacTarget(targetId);
  return { containerId: id, mac };
}

async function setContainerLink(targetId: string, state: "up" | "down"): Promise<void> {
  const { containerId, mac } = parseContainerLinkTargetId(targetId);

  if (!isValidContainerRef(containerId)) {
    throw new Error("Invalid container id.");
  }
  if (!mac || !isValidMacAddress(mac)) {
    // Not just defensive: this is exactly the multi-homed-container gap -
    // without a MAC we have no reliable way to know which of the
    // container's interfaces to target, so refuse rather than guess eth0.
    throw new Error("Could not determine which network interface to target for this container.");
  }

  const pid = await resolveContainerPid(containerId);
  await runPkexecHelper(["container-link", pid, containerId, mac, state]);
}

async function setBridgeForwarding(bridgeName: string, state: "up" | "down"): Promise<void> {
  if (!isValidInterfaceName(bridgeName)) {
    throw new Error("Invalid bridge name.");
  }

  await runPkexecHelper(["bridge-forward", bridgeName, state === "up" ? "allow" : "deny"]);
}

export function parseBridgeLinkTargetId(targetId: string): { bridgeA: string; bridgeB: string } {
  const separatorIndex = targetId.indexOf("|");
  if (separatorIndex === -1) {
    throw new Error("Malformed bridge-link target id.");
  }

  return {
    bridgeA: targetId.slice(0, separatorIndex),
    bridgeB: targetId.slice(separatorIndex + 1)
  };
}

async function setBridgeLink(bridgeA: string, bridgeB: string, state: "up" | "down"): Promise<void> {
  if (!isValidInterfaceName(bridgeA) || !isValidInterfaceName(bridgeB)) {
    throw new Error("Invalid bridge name.");
  }
  if (bridgeA === bridgeB) {
    throw new Error("Cannot link a bridge to itself.");
  }

  await runPkexecHelper(["bridge-link", bridgeA, bridgeB, state === "up" ? "connect" : "disconnect"]);
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

/**
 * Both container-link and vm-link target ids are `${entityId}|${mac}` - one
 * shared parser, split on the *last* "|" so an entity id/domain name that
 * itself happens to contain "|" still parses correctly (a MAC address never
 * does).
 */
function parseIdMacTarget(targetId: string): { id: string; mac: string | undefined } {
  const separatorIndex = targetId.lastIndexOf("|");
  if (separatorIndex === -1) {
    return { id: targetId, mac: undefined };
  }

  return {
    id: targetId.slice(0, separatorIndex),
    mac: targetId.slice(separatorIndex + 1)
  };
}

export function parseVmLinkTargetId(targetId: string): { domain: string; mac: string } {
  const { id, mac } = parseIdMacTarget(targetId);
  if (!mac) {
    throw new Error("Malformed vm-link target id.");
  }

  return { domain: id, mac };
}

/** The Docker network name currently backing a bridge name - resolved fresh (not from a stale topology snapshot) since reattach changes this exact mapping. */
async function resolveDockerNetworkNameForBridge(bridgeName: string): Promise<string> {
  const networks = await listDockerNetworks();
  const match = networks.find((network) => dockerNetworkBridgeName(network) === bridgeName);
  if (!match) {
    throw new Error(`No Docker network found for bridge ${bridgeName}.`);
  }

  return match.name;
}

/** Which of a container's *current* network attachments has this MAC - re-inspected fresh rather than trusting the topology snapshot the drag started from. */
async function resolveDockerNetworkNameByMac(containerId: string, mac: string): Promise<string> {
  const result = await execCommand("docker", ["inspect", "--type", "container", containerId], {
    timeoutMs: PROCESS_LIMITS.capabilityCheckMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "capability-check"
  });

  const parsed = z.array(ContainerInspectSchema).safeParse(JSON.parse(result.stdout));
  const inspected = parsed.success ? parsed.data[0] : undefined;
  if (!inspected) {
    throw new Error(`Could not inspect container ${containerId}.`);
  }

  const network = toContainerDetails(inspected).networks.find(
    (entry) => entry.macAddress?.toLowerCase() === mac.toLowerCase()
  );
  if (!network) {
    throw new Error(`Container ${containerId} has no current network attachment with MAC ${mac}.`);
  }

  return network.name;
}

async function setContainerReattach(targetId: string, toBridge: string): Promise<void> {
  const { containerId, mac } = parseContainerLinkTargetId(targetId);

  if (!isValidContainerRef(containerId)) {
    throw new Error("Invalid container id.");
  }
  if (!mac || !isValidMacAddress(mac)) {
    throw new Error("Could not determine which network interface to move for this container.");
  }
  if (!isValidInterfaceName(toBridge)) {
    throw new Error("Invalid target bridge name.");
  }

  const [oldNetworkName, newNetworkName] = await Promise.all([
    resolveDockerNetworkNameByMac(containerId, mac),
    resolveDockerNetworkNameForBridge(toBridge)
  ]);

  if (oldNetworkName === newNetworkName) {
    return;
  }

  await execCommand("docker", ["network", "disconnect", oldNetworkName, containerId], {
    timeoutMs: PROCESS_LIMITS.composeOperationMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "network-control"
  });
  await execCommand("docker", ["network", "connect", newNetworkName, containerId], {
    timeoutMs: PROCESS_LIMITS.composeOperationMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "network-control"
  });
}

async function setVmReattach(targetId: string, toBridge: string): Promise<void> {
  const { domain, mac } = parseVmLinkTargetId(targetId);

  if (!isValidLibvirtDomainName(domain)) {
    throw new Error("Invalid domain name.");
  }
  if (!isValidMacAddress(mac)) {
    throw new Error("Invalid MAC address.");
  }
  if (!isValidInterfaceName(toBridge)) {
    throw new Error("Invalid target bridge name.");
  }

  // "bridge" type (not "network") so this can retarget onto *any* host
  // bridge by name - a plain Linux bridge, a Docker network's bridge, or a
  // libvirt-managed one - not just other libvirt-defined networks. --mac is
  // reused so the VM's guest-side config (DHCP reservations etc.) still
  // recognizes the interface after the move.
  await execCommand(
    "virsh",
    ["-c", LIBVIRT_URI, "detach-interface", domain, "--mac", mac, "--persistent"],
    {
      timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
      maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
      category: "runtime-discovery"
    }
  );
  await execCommand(
    "virsh",
    ["-c", LIBVIRT_URI, "attach-interface", domain, "bridge", toBridge, "--mac", mac, "--model", "virtio", "--persistent"],
    {
      timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
      maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
      category: "runtime-discovery"
    }
  );
}

/**
 * Attaches to an *additional* network the device isn't already on - no
 * disconnect step, unlike reattach. targetId here is just a bare container
 * id (no mac): there's no existing interface being targeted, so nothing to
 * disambiguate.
 */
async function setContainerConnect(containerId: string, toBridge: string): Promise<void> {
  if (!isValidContainerRef(containerId)) {
    throw new Error("Invalid container id.");
  }
  if (!isValidInterfaceName(toBridge)) {
    throw new Error("Invalid target bridge name.");
  }

  const newNetworkName = await resolveDockerNetworkNameForBridge(toBridge);

  await execCommand("docker", ["network", "connect", newNetworkName, containerId], {
    timeoutMs: PROCESS_LIMITS.composeOperationMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "network-control"
  });
}

/** Same idea as setContainerConnect, for VMs: attaches a brand new interface (fresh MAC, libvirt-assigned) rather than moving an existing one. */
async function setVmConnect(domain: string, toBridge: string): Promise<void> {
  if (!isValidLibvirtDomainName(domain)) {
    throw new Error("Invalid domain name.");
  }
  if (!isValidInterfaceName(toBridge)) {
    throw new Error("Invalid target bridge name.");
  }

  await execCommand(
    "virsh",
    ["-c", LIBVIRT_URI, "attach-interface", domain, "bridge", toBridge, "--model", "virtio", "--persistent"],
    {
      timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
      maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
      category: "runtime-discovery"
    }
  );
}

async function executeRequest(request: NetworkActionRequest): Promise<void> {
  switch (request.verb) {
    case "container-link":
      return setContainerLink(request.targetId, request.state);
    case "bridge-forward":
      return setBridgeForwarding(request.targetId, request.state);
    case "vm-link": {
      const { domain, mac } = parseVmLinkTargetId(request.targetId);
      return setVmLink(domain, mac, request.state);
    }
    case "bridge-link": {
      const { bridgeA, bridgeB } = parseBridgeLinkTargetId(request.targetId);
      return setBridgeLink(bridgeA, bridgeB, request.state);
    }
    case "container-reattach":
      return setContainerReattach(request.targetId, request.toBridge);
    case "vm-reattach":
      return setVmReattach(request.targetId, request.toBridge);
    case "container-connect":
      return setContainerConnect(request.targetId, request.toBridge);
    case "vm-connect":
      return setVmConnect(request.targetId, request.toBridge);
    default: {
      const exhaustiveCheck: never = request;
      throw new Error(`Unsupported request: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

export async function runNetworkAction(request: NetworkActionRequest): Promise<NetworkActionResult> {
  try {
    await executeRequest(request);

    // No manual state patching needed: container-link/bridge-forward/
    // bridge-link all have a real, re-readable source of truth (the state
    // file - see topology-service.ts's readControlState), vm-link's is the
    // domain XML, and reattach just changes what discovery finds directly.
    const topology = await getNetworkTopology();

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
