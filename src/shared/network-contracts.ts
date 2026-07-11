import * as z from "zod";
import type { Result } from "./contracts";

// Kept separate from contracts.ts deliberately: this is a different domain
// (host-wide network topology across containers, VMs, and bridges) from the
// Compose-project model the rest of contracts.ts describes.

export type TopologyNodeKind = "container" | "vm" | "bridge" | "uplink";

export type TopologyNode = {
  id: string;
  kind: TopologyNodeKind;
  name: string;
  status: "up" | "down" | "unknown";
  detail?: string | undefined;
};

export type NetworkActionVerb = "container-link" | "vm-link" | "bridge-forward";

/**
 * `actionTargetId`/`targetId`'s shape depends on `verb` (validated/parsed in
 * network-control-service, not here):
 * - "container-link": a container id (matches CONTAINER_REF_PATTERN)
 * - "vm-link": `${domainName}|${mac}` - domif-setlink needs both the domain
 *   and the interface's MAC address
 * - "bridge-forward": a bridge/interface name
 */
export type TopologyEdge = {
  id: string;
  from: string;
  to: string;
  kind: "attachment" | "uplink";
  state: "up" | "down";
  controllable: boolean;
  verb: NetworkActionVerb;
  actionTargetId: string;
};

export type NetworkTopology = {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  checkedAt: string;
  warning?: string | undefined;
  // False when no polkit authentication agent (GNOME/KDE/XFCE ship one;
  // Hyprland and other minimal WMs typically don't) was detected running -
  // container-link/bridge-forward actions need one to prompt for auth at
  // all, since pkexec has no controlling terminal when spawned from
  // Electron's main process. vm-link is unaffected (no pkexec involved).
  controlAgentAvailable: boolean;
};

export type NetworkActionRequest = {
  verb: NetworkActionVerb;
  targetId: string;
  state: "up" | "down";
};

export const NetworkActionRequestSchema = z.object({
  verb: z.enum(["container-link", "vm-link", "bridge-forward"]),
  targetId: z.string().min(1),
  state: z.enum(["up", "down"])
});

export type NetworkTopologyResult = Result<NetworkTopology>;
export type NetworkActionResult = Result<{ topology: NetworkTopology }>;

// Kept as its own type (rather than folded into contracts.ts's PreloadApi) so
// preload.ts's window.dockerExplorer typing can compose PreloadApi &
// NetworkPreloadApi without the two contract files importing each other.
export type NetworkPreloadApi = {
  getNetworkTopology(): Promise<NetworkTopologyResult>;
  runNetworkAction(request: NetworkActionRequest): Promise<NetworkActionResult>;
};
