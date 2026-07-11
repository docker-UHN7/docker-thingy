import { create } from "zustand";
import type { NetworkActionRequest, NetworkTopology } from "../../shared/network-contracts";

// Everything *except* checkedAt, which changes on literally every poll
// regardless of whether anything real changed - comparing it would defeat
// the whole point of topologiesAreEquivalent below.
function topologySignature(topology: NetworkTopology): string {
  return JSON.stringify({
    nodes: topology.nodes,
    edges: topology.edges,
    warning: topology.warning,
    controlAgentAvailable: topology.controlAgentAvailable
  });
}

export function topologiesAreEquivalent(a: NetworkTopology, b: NetworkTopology): boolean {
  return topologySignature(a) === topologySignature(b);
}

type NetworkState = {
  topology: NetworkTopology | null;
  loading: boolean;
  error: string | undefined;
  pendingEdgeId: string | undefined;
  refresh(): Promise<void>;
  runAction(edgeId: string, request: NetworkActionRequest): Promise<void>;
};

export const useNetworkStore = create<NetworkState>((set, get) => ({
  topology: null,
  loading: true,
  error: undefined,
  pendingEdgeId: undefined,
  async refresh() {
    set({ loading: true, error: undefined });
    try {
      const result = await window.dockerExplorer.getNetworkTopology();
      if (!result.ok) {
        set({ loading: false, error: result.error.message });
        return;
      }

      // Keep the *same* topology object when nothing structurally changed -
      // this poll runs every 5s regardless of activity, and NetworkTopologyView
      // re-runs ELK layout + re-fits the viewport whenever the topology
      // object reference changes. Without this, a poll landing mid-drag
      // (e.g. dragging a reattach/interconnect) would yank the graph back to
      // its default layout and cancel the gesture, even though nothing had
      // actually changed on the wire.
      const current = get().topology;
      const unchanged = current !== null && topologiesAreEquivalent(current, result.data);
      set({ topology: unchanged ? current : result.data, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load network topology."
      });
    }
  },
  async runAction(edgeId, request) {
    if (get().pendingEdgeId) {
      return;
    }

    set({ pendingEdgeId: edgeId, error: undefined });
    try {
      const result = await window.dockerExplorer.runNetworkAction(request);
      if (!result.ok) {
        set({ pendingEdgeId: undefined, error: result.error.message });
        return;
      }

      set({ topology: result.data.topology, pendingEdgeId: undefined });
    } catch (error) {
      set({
        pendingEdgeId: undefined,
        error: error instanceof Error ? error.message : "The network action failed unexpectedly."
      });
    }
  }
}));
