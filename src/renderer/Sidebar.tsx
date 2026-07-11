import {
  ArrowRight,
  Boxes,
  FileCode2,
  FolderPlus,
  LoaderCircle,
  MoonStar,
  Search,
  Settings,
  SunMedium,
  TriangleAlert,
  X
} from "lucide-react";
import { useDeferredValue, useMemo, useState, type DragEvent } from "react";
import type { AppSettings, DockerStatus, ProjectSummary } from "../shared/contracts";
import { useAppStore } from "./store";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { deriveProjectLifecycle } from "./project-state";
import appLogo from "./assets/logo.png";

type SidebarProps = {
  projects: ProjectSummary[];
  activeProjectId: string | undefined;
  dockerStatus: DockerStatus | undefined;
  loading: boolean;
  error: string | undefined;
  theme: "dark" | "light";
  onSelect(projectId: string): void;
  onOpenSource(): void;
  onOpenSourcePath(sourcePath: string): void;
  onOpenRecent(sourcePath: string): void;
  onToggleTheme(): void;
  recents: string[];
  recentLoadingPath?: string | undefined;
  settings?: AppSettings | undefined;
};

function middleTruncate(value: string, head = 20, tail = 16): string {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function isAcceptedSource(path: string): boolean {
  return /(?:docker-compose|compose)\.(?:ya?ml)$|(?:^|[\\/])Dockerfile$/i.test(path);
}

function pathPrimaryLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) {
    return path;
  }

  const file = parts.at(-1) ?? path;
  const parent = parts.at(-2);
  return parent ? `${parent}/${file}` : file;
}

type FileWithPath = File & { path?: string };

export function Sidebar({
  projects,
  activeProjectId,
  dockerStatus,
  loading,
  error,
  theme,
  onSelect,
  onOpenSource,
  onOpenSourcePath,
  onOpenRecent,
  onToggleTheme,
  recents,
  recentLoadingPath,
  settings
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearRecents = useAppStore((state) => state.clearRecents);
  const deferredQuery = useDeferredValue(query);
  const filteredProjects = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    if (!term) {
      return projects;
    }

    return projects.filter((project) => {
      const haystack = [
        project.title,
        project.subtitle,
        project.sourcePath,
        ...project.configFiles,
        ...project.services.flatMap((service) => [service.name, service.image, ...service.ports])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [deferredQuery, projects]);
  const showDaemonBanner = !dockerStatus?.daemonAvailable && !bannerDismissed;
  const showHeaderPrimary = projects.length > 0;
  const staleHint = dockerStatus?.checkedAt
    ? `Docker was unreachable when this was last checked - showing cached data from ${new Date(dockerStatus.checkedAt).toLocaleString()}.`
    : "Docker was unreachable when this was last checked - showing cached data.";

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files) as FileWithPath[];
    const accepted = files.find((file) => file.path && isAcceptedSource(file.path));
    if (accepted?.path) {
      onOpenSourcePath(accepted.path);
    }
  }

  return (
    <main className="launcher-screen">
      <header className="topbar topbar--launcher">
        <div className="brand-lockup">
          <img className="brand-mark brand-mark--image" src={appLogo} alt="" />
          <h1 className="brand-title">VIMOKU</h1>
        </div>

        <div className="topbar__controls">
          <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
          </button>
          <button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen((value) => !value)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {showDaemonBanner ? (
        <div className="daemon-banner">
          <div className="daemon-banner__copy">
            <span className="status-dot status-dot--warning" />
            <span>Docker daemon not detected. Start Docker to see live container status.</span>
          </div>
          <div className="daemon-banner__actions">
            <button className="icon-button" onClick={() => setBannerDismissed(true)} aria-label="Dismiss banner">
              <X size={16} />
            </button>
          </div>
        </div>
      ) : null}

      <section className="launcher-content">
        <div className="launcher-header">
          <div>
            <h2 className="screen-title">Projects</h2>
            <p className="body-copy body-copy--secondary">Manage and inspect your Docker Compose projects.</p>
          </div>
        </div>

        <div className="launcher-toolbar">
          <label className="search-input" aria-label="Search projects">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" />
            {query ? (
              <button className="mini-icon-button launcher-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={14} />
              </button>
            ) : null}
          </label>

          <button className="button button--primary" onClick={onOpenSource}>
            <FolderPlus size={16} />
            <span>Add project</span>
          </button>
        </div>

        <div
          className={`launcher-dropzone ${dropActive ? "launcher-dropzone--active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={handleDrop}
        >
          {loading && projects.length === 0 ? (
            <div className="empty-dropzone">
              <LoaderCircle size={28} className="busy spin" />
              <p>Looking for Docker Compose projects and running containers...</p>
            </div>
          ) : filteredProjects.length === 0 && projects.length === 0 ? (
            <div className="empty-dropzone">
              <FolderPlus size={28} className="empty-dropzone__icon" />
              <div>
                <p className="body-copy">Drop a docker-compose.yml, compose.yaml, or Dockerfile here</p>
                <p className="metadata-note">
                  Or click "Add Project" to browse for one. Running containers appear automatically once Docker is
                  detected.
                </p>
              </div>
              <button className="button button--primary" onClick={onOpenSource}>
                <FolderPlus size={16} />
                <span>Add Project</span>
              </button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="empty-dropzone">
              <p className="body-copy">No projects match "{query}".</p>
              <p className="metadata-note">Try a different search term, or clear the search to see all projects.</p>
            </div>
          ) : (
            <section className="project-list">
              <div className="project-list__header" aria-hidden="true">
                <span>Project</span>
                <span>Services</span>
                <span>Source</span>
                <span>Status</span>
                <span>Updated</span>
                <span>Open</span>
              </div>
              {filteredProjects.map((project) => {
                const location = project.sourcePath ?? project.configFiles[0] ?? "Runtime-only";
                const stale = !dockerStatus?.daemonAvailable;
                const lifecycle = deriveProjectLifecycle(project);
                const statusClass =
                  lifecycle.state === "running" ? "running" : lifecycle.state === "crashed" ? "error" : "stopped";
                const statusLabel =
                  lifecycle.state === "running"
                    ? "Running"
                    : lifecycle.state === "crashed"
                      ? "Crashed"
                      : lifecycle.hasRuntimeMatch
                        ? "Stopped"
                        : "Source only";
                return (
                  <button
                    key={project.id}
                    className={`project-row ${project.id === activeProjectId ? "project-row--active" : ""}`}
                    onClick={() => onSelect(project.id)}
                    title={stale ? staleHint : location}
                  >
                    <div className="project-row__project">
                      <div className="project-row__title">
                        <span
                          className={`status-dot status-dot--${dockerStatus?.daemonAvailable ? statusClass : "stopped"} ${
                            dockerStatus?.daemonAvailable ? "" : "status-dot--stale"
                          } ${
                            dockerStatus?.daemonAvailable && lifecycle.state === "running" ? "pulse" : ""
                          }`}
                        />
                        <span>{project.title}</span>
                      </div>
                      <p className="mono-path" title={location}>
                        {middleTruncate(location, 34, 24)}
                      </p>
                      <div className="project-row__meta">
                        <span><Boxes size={14} /> {project.services.length} services</span>
                        <span><FileCode2 size={14} /> {project.runtimeKind === "compose" ? "Docker Compose" : project.runtimeKind}</span>
                        <span>{project.contextName}</span>
                      </div>
                    </div>

                    <span className="project-row__services">{project.services.length}</span>
                    <span className="project-row__source" title={location}>{middleTruncate(location, 18, 16)}</span>
                    <span className={`project-row__status project-row__status--${statusClass}`}>{statusLabel}</span>
                    <span className="project-row__updated">{project.lastUpdatedLabel}</span>
                    <span className="project-row__open" aria-hidden="true"><ArrowRight size={16} /></span>
                  </button>
                );
              })}
            </section>
          )}
        </div>

        <section className="recent-strip recent-strip--compact">
          <div className="recent-strip__header">
            <div>
              <p className="panel-title">Recent sources</p>
            </div>
          </div>
          {recents.length === 0 ? (
            <p className="metadata-note">Opened Compose files and Dockerfiles will appear here.</p>
          ) : (
            <div className="recent-list">
              {recents.slice(0, 6).map((recent) => {
                const pending = recentLoadingPath === recent;
                return (
                  <button
                    key={recent}
                    className="recent-item recent-item--button"
                    title={recent}
                    onClick={() => onOpenRecent(recent)}
                    disabled={pending}
                  >
                    {pending ? <LoaderCircle size={14} className="busy spin" /> : null}
                    <div className="recent-item__copy">
                      <span className="recent-item__title">{pathPrimaryLabel(recent)}</span>
                      <span className="mono-path">{middleTruncate(recent, 44, 20)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </section>

      {settingsOpen && settings ? (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <aside className="settings-modal" onClick={(event) => event.stopPropagation()}>
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
        </div>
      ) : null}
    </main>
  );
}
