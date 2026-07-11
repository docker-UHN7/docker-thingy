import {
  ArrowLeft,
  LayoutPanelTop,
  MoonStar,
  RefreshCw,
  ScanSearch,
  Settings,
  Shrink,
  SunMedium,
  X
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { AppSettings, DockerStatus, LogSnapshotResult, ProjectAction, ProjectSummary, ServiceNodeModel } from "../shared/contracts";
import { useAppStore } from "./store";
import { GraphView } from "./graph/GraphView";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { Inspector } from "./Inspector";
import { LogsPanel } from "./LogsPanel";
import { OperationPanel } from "./OperationPanel";
import { ValidationPanel } from "./ValidationPanel";

type ProjectWorkspaceProps = {
  project: ProjectSummary | undefined;
  dockerStatus: DockerStatus | undefined;
  settings: AppSettings | undefined;
  theme: "dark" | "light";
  loading: boolean;
  error: string | undefined;
  onBack(): void;
  onRefresh(): void;
  onToggleTheme(): void;
};

type DetailTab = "overview" | "env" | "mounts" | "logs";

function relativeTimeLabel(value: string | undefined): string {
  if (!value) {
    return "not available";
  }

  const start = new Date(value).getTime();
  if (!Number.isFinite(start)) {
    return "not available";
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function ProjectWorkspace({
  project,
  dockerStatus,
  settings,
  theme,
  loading,
  error,
  onBack,
  onRefresh,
  onToggleTheme
}: ProjectWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [envFilter, setEnvFilter] = useState("");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [layoutDirection, setLayoutDirection] = useState<"RIGHT" | "DOWN">("RIGHT");
  const [fitNonce, setFitNonce] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsState, setLogsState] = useState<LogSnapshotResult | null>(null);
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const deferredQuery = useDeferredValue(query);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearRecents = useAppStore((state) => state.clearRecents);

  const selectedService = useMemo(
    () => project?.services.find((service) => service.id === selectedNodeId) ?? project?.services[0],
    [project, selectedNodeId]
  );

  const visibleEnv = useMemo(() => {
    const env = selectedService?.details?.env ?? [];
    const term = envFilter.trim().toLowerCase();
    return term ? env.filter((entry) => entry.key.toLowerCase().includes(term)) : env;
  }, [envFilter, selectedService]);

  useEffect(() => {
    if (!selectedService) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedNodeId(undefined);
        setSettingsOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedService]);

  useEffect(() => {
    const containerId = selectedService?.details?.containerId;
    const tail = settings?.logTailLines;
    if (detailTab !== "logs" || !containerId || !tail) {
      return;
    }
    const containerIdSafe = containerId;
    const tailSafe = tail;

    let cancelled = false;

    async function loadLogs() {
      const result = await window.dockerExplorer.getServiceLogs(containerIdSafe, tailSafe);
      if (!cancelled) {
        setLogsState(result);
      }
    }

    void loadLogs();

    const intervalMs = settings.runtimeRefreshSeconds ? settings.runtimeRefreshSeconds * 1000 : null;
    const intervalId = intervalMs ? window.setInterval(() => void loadLogs(), intervalMs) : undefined;

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [detailTab, selectedService?.details?.containerId, settings?.logTailLines, settings?.runtimeRefreshSeconds]);

  if (!project) {
    return (
      <main className="workspace-screen">
        <header className="topbar topbar--workspace">
          <div className="toolbar-left">
            <button className="icon-button" onClick={onBack} aria-label="Back to projects">
              <ArrowLeft size={16} />
            </button>
            <h2 className="screen-title">Docker Graph</h2>
          </div>
          <div className="topbar__controls">
            <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
            </button>
          </div>
        </header>

        <div className="workspace-empty">
          <div className="hero-card">
            <p className="eyebrow">Nothing discovered yet</p>
            <h2 className="screen-title">
              {dockerStatus?.daemonAvailable
                ? "Docker is reachable, but there are no Compose projects or standalone containers to show yet."
                : "Start Docker or open a Compose source to begin."}
            </h2>
            <p className="body-copy">
              {dockerStatus?.daemonAvailable
                ? "Try Refresh runtime, start a container, or open an explicit Compose source."
                : dockerStatus?.message ?? "No Docker runtime data is available yet."}
            </p>
          </div>
        </div>
      </main>
    );
  }

  function handleAction(action: ProjectAction) {
    if (action.confirmation && !window.confirm(action.confirmation)) {
      return;
    }

    if (action.id === "refresh") {
      onRefresh();
      return;
    }

    setActionMessage(`Action "${action.label}" is surfaced, but backend execution is not wired yet.`);
  }

  const runtimeStateLabel = dockerStatus?.daemonAvailable ? "connected" : loading ? "reconnecting..." : "offline";
  const uptimeLabel = relativeTimeLabel(selectedService?.details?.runtimeState.startedAt);
  const dependencyCount = project.services.reduce((count, service) => count + service.dependencyDetails.length, 0);
  const volumeCount = new Set(project.services.flatMap((service) => service.categories.volumes)).size;
  const networkCount = new Set(project.services.flatMap((service) => service.categories.networks)).size;

  return (
    <main className="workspace-screen">
      <header className="topbar topbar--workspace">
        <div className="toolbar-left">
          <button className="icon-button" onClick={onBack} aria-label="Back to projects">
            <ArrowLeft size={16} />
          </button>
          <div className="toolbar-project">
            <h2 className="toolbar-project__title">{project.title}</h2>
            <div className="live-indicator">
              <span
                className={`status-dot status-dot--${dockerStatus?.daemonAvailable ? "running" : "stopped"} ${
                  dockerStatus?.daemonAvailable ? "pulse" : ""
                }`}
              />
              <span className="metadata-note">{runtimeStateLabel}</span>
            </div>
          </div>
        </div>

        <div className="toolbar-tools">
          <label className="search-input search-input--workspace">
            <ScanSearch size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name, image, or port" />
          </label>
          <button
            className="button button--secondary"
            onClick={() => setLayoutDirection((current) => (current === "RIGHT" ? "DOWN" : "RIGHT"))}
          >
            <LayoutPanelTop size={16} />
            <span>{layoutDirection === "RIGHT" ? "Layout: Left to right" : "Layout: Top to bottom"}</span>
          </button>
          <button className="icon-button" onClick={() => setFitNonce((value) => value + 1)} aria-label="Fit view">
            <Shrink size={16} />
          </button>
          <button className="icon-button" onClick={onRefresh} aria-label="Refresh runtime">
            <RefreshCw size={16} className={loading ? "busy spin" : undefined} />
          </button>
          <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
          </button>
          <button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen((value) => !value)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div className="workspace-frame">
        <section className="graph-stage">
          <div className="graph-stage__header">
            <div>
              <p className="eyebrow">{project.contextName}</p>
              <div className="stage-meta">
                <span className="manifest-tag">{project.access}</span>
                <span className="manifest-tag">{project.runtimeKind}</span>
                <span className="metadata-note">{project.lastUpdatedLabel}</span>
              </div>
              <p className="graph-summary">
                {project.services.length} services, {dependencyCount} dependency edges, {networkCount} networks, {volumeCount} volumes
              </p>
            </div>
            <div className="toolbar-note-cluster">
              {actionMessage ? <span className="toolbar-note">{actionMessage}</span> : null}
              {error ? <span className="toolbar-note toolbar-note--error">{error}</span> : null}
              {!dockerStatus?.daemonAvailable && dockerStatus?.message ? (
                <span className="toolbar-note">{dockerStatus.message}</span>
              ) : null}
            </div>
          </div>

          <OperationPanel actions={project.actions} onAction={handleAction} />
          <ValidationPanel diagnostics={project.diagnostics} />

          <GraphView
            project={project}
            filterQuery={deferredQuery}
            selectedNodeId={selectedService?.id}
            layoutDirection={layoutDirection}
            fitNonce={fitNonce}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              setDetailTab("overview");
              setSettingsOpen(false);
            }}
            onClearSelection={() => setSelectedNodeId(undefined)}
          />
        </section>

        {settingsOpen && settings ? (
          <aside className="detail-panel">
            <div className="detail-panel__header">
              <div>
                <p className="eyebrow">Settings</p>
                <h3 className="panel-title">Workspace preferences</h3>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <X size={16} />
              </button>
            </div>
            <ConfigurationPanel
              settings={settings}
              onUpdate={(next) => void updateSettings(next)}
              onClearRecents={() => void clearRecents()}
            />
          </aside>
        ) : null}

        {!settingsOpen && selectedService ? (
          <aside className="detail-panel">
            <div className="detail-panel__header">
              <div>
                <p className="eyebrow">Detail Panel</p>
                <h3 className="panel-title">{selectedService.name}</h3>
              </div>
              <button className="icon-button" onClick={() => setSelectedNodeId(undefined)} aria-label="Close panel">
                <X size={16} />
              </button>
            </div>

            <div className="detail-tabs">
              {(["overview", "env", "mounts", "logs"] as DetailTab[]).map((tab) => (
                <button
                  key={tab}
                  className={`detail-tab ${detailTab === tab ? "detail-tab--active" : ""}`}
                  onClick={() => setDetailTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {detailTab === "overview" ? <Inspector service={selectedService} uptimeLabel={uptimeLabel} /> : null}

            {detailTab === "env" ? (
              <div className="detail-stack">
                {(selectedService.details?.env.length ?? 0) > 15 ? (
                  <label className="search-input">
                    <ScanSearch size={16} />
                    <input value={envFilter} onChange={(event) => setEnvFilter(event.target.value)} placeholder="Filter env vars" />
                  </label>
                ) : null}
                <div className="detail-table">
                  {visibleEnv.length === 0 ? (
                    <div className="detail-list__row">
                      <span className="mono-key">Runtime env</span>
                      <span className="mono-value">Not available for this service.</span>
                    </div>
                  ) : (
                    visibleEnv.map((entry) => (
                      <div key={entry.key} className="detail-list__row detail-list__row--column">
                        <div className="detail-row-main">
                          <span className="mono-key">{entry.key}</span>
                          <span className="mono-value">{entry.masked ? "••••••••" : entry.value}</span>
                        </div>
                        <button className="button button--secondary" onClick={() => void navigator.clipboard.writeText(entry.value)}>
                          Copy
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {detailTab === "mounts" ? (
              <div className="detail-table">
                {selectedService.details?.mounts.length ? (
                  selectedService.details.mounts.map((mount) => (
                    <div key={`${mount.source}:${mount.destination}`} className="mount-row">
                      <span className={`manifest-tag manifest-tag--${mount.type}`}>{mount.type}</span>
                      <span className="mono-value">{mount.source}</span>
                      <span className="mono-value">{mount.destination}</span>
                      <span className="manifest-tag">{mount.rw ? "rw" : "ro"}</span>
                    </div>
                  ))
                ) : (
                  <div className="detail-list__row">
                    <span className="mono-key">Mounts</span>
                    <span className="mono-value">No runtime mounts detected.</span>
                  </div>
                )}
              </div>
            ) : null}

            {detailTab === "logs" ? (
              selectedService.details?.containerId ? (
                logsState?.ok ? (
                  <LogsPanel lines={logsState.data.lines} fetchedAt={logsState.data.fetchedAt} />
                ) : (
                  <div className="detail-list__row">
                    <span className="mono-key">Logs</span>
                    <span className="mono-value">{logsState?.error.message ?? "Loading logs..."}</span>
                  </div>
                )
              ) : (
                <div className="detail-list__row">
                  <span className="mono-key">Logs</span>
                  <span className="mono-value">Runtime logs are not available for source-only services.</span>
                </div>
              )
            ) : null}
          </aside>
        ) : null}
      </div>
    </main>
  );
}
