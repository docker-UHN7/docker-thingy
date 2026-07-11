import { create } from "zustand";
import type { NetworkActionVerb, NetworkTopology } from "../../shared/network-contracts";

type NetworkState = {
  topology: NetworkTopology | null;
  loading: boolean;
  error: string | undefined;
  pendingEdgeId: string | undefined;
  refresh(): Promise<void>;
  runAction(edgeId: string, verb: NetworkActionVerb, targetId: string, state: "up" | "down"): Promise<void>;
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

      set({ topology: result.data, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load network topology."
      });
    }
  },
  async runAction(edgeId, verb, targetId, state) {
    if (get().pendingEdgeId) {
      return;
    }

    set({ pendingEdgeId: edgeId, error: undefined });
    try {
      const result = await window.dockerExplorer.runNetworkAction({ verb, targetId, state });
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
