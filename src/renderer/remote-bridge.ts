import type {
  AddServiceResult,
  AppSnapshot,
  LogSnapshotResult,
  OperationEvent,
  PreloadApi,
  ProjectActionResult,
  ReadSourceFileResult,
  RemoveServiceResult,
  SaveSourceFileResult,
  SearchDockerHubResult,
  StatsSnapshotResult
} from "../shared/contracts";
import type { NetworkActionResult, NetworkPreloadApi, NetworkTopologyResult } from "../shared/network-contracts";
import type { RemoteAccessPreloadApi, RemoteAccessStatus } from "../shared/remote-access-contracts";

// Implements the exact same PreloadApi/NetworkPreloadApi contract Electron's
// contextBridge exposes locally, but backed by fetch/EventSource against the
// HTTP(S) surface remote-access-service.ts serves - so store.ts/networkStore.ts
// need zero changes to work identically whether window.dockerExplorer came
// from Electron's preload script or from here (see remote-bridge-bootstrap.ts).

const NOT_LOCAL_MESSAGE = "Adding new projects requires the local app, not the remote connection.";
const REMOTE_MANAGEMENT_MESSAGE = "Remote access can only be managed from the local app.";
const OPEN_EXTERNAL_MESSAGE =
  "Opening a published port isn't supported remotely - \"localhost\" would resolve to your own machine, not the server.";

async function authHeaders(token: string): Promise<Record<string, string>> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseErrorMessage(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
    return payload.message;
  }
  return `Request failed (${response.status}).`;
}

async function getJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(path, { headers: await authHeaders(token) });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown, token: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders(token)) },
    body: JSON.stringify(body ?? {})
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
  return (await response.json()) as T;
}

function subscribeSse<T>(event: "build" | "snapshot", listener: (payload: T) => void, token: string): () => void {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  const handler = (messageEvent: MessageEvent<string>) => {
    try {
      listener(JSON.parse(messageEvent.data) as T);
    } catch (error) {
      console.error(`[remote-bridge] ${event} event listener failed`, error);
    }
  };
  source.addEventListener(event, handler as EventListener);
  return () => {
    source.removeEventListener(event, handler as EventListener);
    source.close();
  };
}

export function createRemoteBridge(token: string): PreloadApi & NetworkPreloadApi & RemoteAccessPreloadApi {
  return {
    // A real browser tab (unlike the Electron BrowserWindow) isn't subject
    // to main.ts's blanket permission denial, so the standard web Clipboard
    // API works fine here.
    copyToClipboard: (text) => navigator.clipboard.writeText(text),
    getSnapshot: () => getJson<AppSnapshot>("/api/snapshot", token),
    openSource: () => Promise.reject(new Error(NOT_LOCAL_MESSAGE)),
    openSourcePath: () => Promise.reject(new Error(NOT_LOCAL_MESSAGE)),
    openRecentSource: () => Promise.reject(new Error(NOT_LOCAL_MESSAGE)),
    openExternalUrl: () => Promise.reject(new Error(OPEN_EXTERNAL_MESSAGE)),
    getServiceLogs: (containerId, tail) => postJson<LogSnapshotResult>("/api/service-logs", { containerId, tail }, token),
    getServiceStats: (containerId) => postJson<StatsSnapshotResult>("/api/service-stats", { containerId }, token),
    updateSettings: (settings) => postJson<AppSnapshot>("/api/settings", settings, token),
    clearRecents: () => postJson<AppSnapshot>("/api/clear-recents", undefined, token),
    updateProjectConfigFiles: (projectId, configFiles) =>
      postJson<AppSnapshot>("/api/project-config-files", { projectId, configFiles }, token),
    readSourceFile: (projectId, filePath) =>
      postJson<ReadSourceFileResult>("/api/read-source-file", { projectId, filePath }, token),
    saveSourceFile: (projectId, filePath, sourceText, expectedHash) =>
      postJson<SaveSourceFileResult>("/api/save-source-file", { projectId, filePath, sourceText, expectedHash }, token),
    searchDockerHub: (query) => postJson<SearchDockerHubResult>("/api/search-docker-hub", { query }, token),
    addServiceToProject: (projectId, input) =>
      postJson<AddServiceResult>("/api/add-service", { projectId, input }, token),
    removeServiceFromProject: (projectId, serviceName) =>
      postJson<RemoveServiceResult>("/api/remove-service", { projectId, serviceName }, token),
    runProjectAction: (projectId, actionId) =>
      postJson<ProjectActionResult>("/api/project-action", { projectId, actionId }, token),
    subscribeBuildEvents: (listener) => subscribeSse<OperationEvent>("build", listener, token),
    subscribeSnapshotEvents: (listener) => subscribeSse<AppSnapshot>("snapshot", listener, token),
    getNetworkTopology: () => getJson<NetworkTopologyResult>("/api/network-topology", token),
    runNetworkAction: (request) => postJson<NetworkActionResult>("/api/network-action", request, token),
    getRemoteAccessStatus: () => Promise.resolve<RemoteAccessStatus>({ enabled: false, detectedAddresses: [] }),
    enableRemoteAccess: () => Promise.reject(new Error(REMOTE_MANAGEMENT_MESSAGE)),
    disableRemoteAccess: () => Promise.reject(new Error(REMOTE_MANAGEMENT_MESSAGE)),
    regenerateRemoteAccessToken: () => Promise.reject(new Error(REMOTE_MANAGEMENT_MESSAGE)),
    setRemoteAccessHost: () => Promise.reject(new Error(REMOTE_MANAGEMENT_MESSAGE))
  };
}
