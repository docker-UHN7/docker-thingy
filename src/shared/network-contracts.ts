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

export type NetworkActionVerb =
  | "container-link"
  | "vm-link"
  | "bridge-forward"
  | "bridge-link"
  | "container-reattach"
  | "vm-reattach"
  | "container-connect"
  | "vm-connect";

/**
 * `actionTargetId`/`targetId`'s shape depends on `verb` (validated/parsed in
 * network-control-service, not here):
 * - "container-link": `${containerId}|${mac}` - a container can be
 *   multi-homed, so the MAC identifies which specific interface to target
 * - "vm-link": `${domainName}|${mac}` - domif-setlink needs both the domain
 *   and the interface's MAC address
 * - "bridge-forward": a bridge/interface name
 * - "bridge-link": `${bridgeA}|${bridgeB}`, canonically sorted so drag
 *   direction doesn't matter
 */
export type TopologyEdge = {
  id: string;
  from: string;
  to: string;
  kind: "attachment" | "uplink" | "interconnect";
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

/**
 * A toggle (up/down on an existing attachment), a reattach (move an
 * existing attachment to a *different* bridge), or a fresh connect (attach
 * to an *additional* bridge the device isn't already on - no disconnect
 * step, unlike reattach). `toBridge` is always a bridge/interface name,
 * matching how bridge-forward/bridge-link already reference bridges. None
 * of these need any privilege: containers move/gain networks via plain
 * `docker network connect/disconnect`, VMs via
 * `virsh attach-interface`/`detach-interface` - both already covered by the
 * same libvirt/docker group membership the rest of this feature relies on.
 */
export type NetworkActionRequest =
  | { verb: "container-link" | "vm-link" | "bridge-forward" | "bridge-link"; targetId: string; state: "up" | "down" }
  | {
      verb: "container-reattach" | "vm-reattach" | "container-connect" | "vm-connect";
      targetId: string;
      toBridge: string;
    };

export const NetworkActionRequestSchema = z.union([
  z.object({
    verb: z.enum(["container-link", "vm-link", "bridge-forward", "bridge-link"]),
    targetId: z.string().min(1),
    state: z.enum(["up", "down"])
  }),
  z.object({
    verb: z.enum(["container-reattach", "vm-reattach", "container-connect", "vm-connect"]),
    targetId: z.string().min(1),
    toBridge: z.string().min(1)
  })
]);

export type NetworkTopologyResult = Result<NetworkTopology>;
export type NetworkActionResult = Result<{ topology: NetworkTopology }>;

// Kept as its own type (rather than folded into contracts.ts's PreloadApi) so
// preload.ts's window.dockerExplorer typing can compose PreloadApi &
// NetworkPreloadApi without the two contract files importing each other.
export type NetworkPreloadApi = {
  getNetworkTopology(): Promise<NetworkTopologyResult>;
  runNetworkAction(request: NetworkActionRequest): Promise<NetworkActionResult>;
};
