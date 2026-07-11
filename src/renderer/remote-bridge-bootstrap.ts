import { createRemoteBridge } from "./remote-bridge";

// Electron's preload script (see src/preload.ts) already sets
// window.dockerExplorer via contextBridge before any renderer script runs -
// so this only ever installs anything when the bundle is loaded in a plain
// browser tab via remote-access-service.ts. Must run before store.ts's
// module-load-time subscribeBuildEvents/subscribeSnapshotEvents check, so
// this import has to stay first in renderer.tsx.
if (typeof window !== "undefined" && !window.dockerExplorer) {
  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get("token");
  if (tokenFromUrl) {
    window.sessionStorage.setItem("dt-remote-token", tokenFromUrl);
    // Scrub the token out of the visible URL/browser history immediately -
    // it's stashed in sessionStorage from here on.
    window.history.replaceState(null, "", window.location.pathname);
  }

  const token = window.sessionStorage.getItem("dt-remote-token") ?? "";
  window.dockerExplorer = createRemoteBridge(token);
}
