import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../src/renderer/store";

describe("theme updates", () => {
  beforeEach(() => {
    useAppStore.setState({
      snapshot: null,
      loading: false,
      theme: "dark",
      error: undefined,
      recentLoadingPath: undefined,
      operations: {},
      selectedProjectId: undefined
    });

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  it("applies the next theme immediately before the IPC round trip finishes", async () => {
    const persistedSnapshot = {
      dockerStatus: {
        cliAvailable: true,
        daemonAvailable: true,
        composeAvailable: true,
        buildxAvailable: true,
        message: "ok"
      },
      projects: [],
      recents: [],
      activeProjectId: undefined,
      settings: {
        themeMode: "dark",
        runtimeRefreshSeconds: 3,
        statsPollSeconds: 3,
        logTailLines: 200
      }
    };

    useAppStore.setState({ snapshot: persistedSnapshot as never, theme: "dark" });

    let resolveUpdate: ((snapshot: typeof persistedSnapshot) => void) | undefined;
    const updateSettingsPromise = new Promise<typeof persistedSnapshot>((resolve) => {
      resolveUpdate = resolve;
    });

    window.dockerExplorer = {
      updateSettings: vi.fn().mockReturnValue(updateSettingsPromise)
    } as never;

    const updatePromise = useAppStore.getState().updateSettings({ themeMode: "light" });

    expect(useAppStore.getState().theme).toBe("light");
    expect(useAppStore.getState().snapshot?.settings.themeMode).toBe("light");

    resolveUpdate?.(persistedSnapshot);
    await updatePromise;
  });

  it("makes the toggle button switch directly between visible dark and light themes", () => {
    useAppStore.setState({
      snapshot: {
        dockerStatus: {
          cliAvailable: true,
          daemonAvailable: true,
          composeAvailable: true,
          buildxAvailable: true,
          message: "ok"
        },
        projects: [],
        recents: [],
        activeProjectId: undefined,
        settings: {
          themeMode: "system",
          runtimeRefreshSeconds: 3,
          statsPollSeconds: 3,
          logTailLines: 200
        }
      } as never,
      theme: "light"
    });

    const updateSettings = vi.spyOn(useAppStore.getState(), "updateSettings").mockResolvedValue(undefined);

    useAppStore.getState().toggleTheme();
    expect(updateSettings).toHaveBeenCalledWith({ themeMode: "dark" });

    updateSettings.mockClear();
    useAppStore.setState({ theme: "dark" });

    useAppStore.getState().toggleTheme();
    expect(updateSettings).toHaveBeenCalledWith({ themeMode: "light" });
  });
});
