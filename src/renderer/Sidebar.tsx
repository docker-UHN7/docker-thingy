import { FolderPlus, LoaderCircle, MoonStar, RefreshCw, Search, Settings, SunMedium, X } from "lucide-react";
import { useDeferredValue, useMemo, useState, type DragEvent } from "react";
import type { AppSettings, DockerStatus, ProjectSummary } from "../shared/contracts";

type SidebarProps = {
  projects: ProjectSummary[];
  activeProjectId: string | undefined;
  dockerStatus: DockerStatus | undefined;
  loading: boolean;
  error: string | undefined;
  theme: "dark" | "light";
  onSelect(projectId: string): void;
  onRefresh(): void;
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

function projectState(project: ProjectSummary): "running" | "stopped" | "warning" {
  const hasRunning = project.services.some((service) => service.status === "running");
  const hasStopped = project.services.some((service) => service.status !== "running");

  if (hasRunning && hasStopped) {
    return "warning";
  }

  return hasRunning ? "running" : "stopped";
}

function isAcceptedSource(path: string): boolean {
  return /(?:docker-compose|compose)\.(?:ya?ml)$|(?:^|[\\/])Dockerfile$/i.test(path);
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
  onRefresh,
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
          <div className="brand-mark">DG</div>
          <h1 className="brand-title">Docker Graph</h1>
        </div>

        <div className="topbar__controls">
          <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
          </button>
          <button className="icon-button" aria-label="Settings">
            <Settings size={16} />
          </button>
        </div>
      </header>

      {showDaemonBanner ? (
        <div className="daemon-banner">
          <div className="daemon-banner__copy">
            <span className="status-dot status-dot--warning" />
            <span>Docker daemon not detected. Start Docker to see live container status.</span>
          </div>
          <div className="daemon-banner__actions">
            <button className="icon-button" onClick={onRefresh} aria-label="Retry runtime discovery">
              <RefreshCw size={16} className={loading ? "busy" : undefined} />
            </button>
            <button className="icon-button" onClick={() => setBannerDismissed(true)} aria-label="Dismiss banner">
              <X size={16} />
            </button>
          </div>
        </div>
      ) : null}

      <section className="launcher-content">
        <div className="launcher-header">
          <div>
            <p className="eyebrow">Project Selector</p>
            <h2 className="screen-title">Projects</h2>
          </div>
          {showHeaderPrimary ? (
            <button className="button button--primary" onClick={onOpenSource}>
              <FolderPlus size={16} />
              <span>Add Project</span>
            </button>
          ) : null}
        </div>

        <div className="launcher-tools">
          <label className="search-input" aria-label="Search projects">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects..." />
          </label>

          <div className="launcher-meta">
            {loading ? <span className="toolbar-note">Refreshing runtime...</span> : null}
            {settings?.runtimeRefreshSeconds ? (
              <span className="toolbar-note">Refresh every {settings.runtimeRefreshSeconds}s</span>
            ) : (
              <span className="toolbar-note">Manual refresh only</span>
            )}
            {error ? <span className="toolbar-note toolbar-note--error">{error}</span> : null}
          </div>
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
          {filteredProjects.length === 0 ? (
            <div className="empty-dropzone">
              <p>Drop a docker-compose.yml, compose.yaml, or Dockerfile here.</p>
              <button className="button button--primary" onClick={onOpenSource}>
                <FolderPlus size={16} />
                <span>Add Project</span>
              </button>
            </div>
          ) : (
            <div className="project-grid">
              {filteredProjects.map((project) => {
                const location = project.sourcePath ?? project.configFiles[0] ?? "Runtime-only";
                const stale = !dockerStatus?.daemonAvailable;
                return (
                  <button
                    key={project.id}
                    className={`project-card ${project.id === activeProjectId ? "project-card--active" : ""}`}
                    onClick={() => onSelect(project.id)}
                    title={stale ? staleHint : location}
                  >
                    <div className="project-card__head">
                      <div className="project-card__title">
                        <span
                          className={`status-dot status-dot--${dockerStatus?.daemonAvailable ? projectState(project) : "stopped"} ${
                            dockerStatus?.daemonAvailable ? "" : "status-dot--stale"
                          } ${
                            dockerStatus?.daemonAvailable && projectState(project) === "running" ? "pulse" : ""
                          }`}
                        />
                        <span>{project.title}</span>
                      </div>
                      <span className="mini-icon-button" aria-hidden="true">
                        <FolderPlus size={14} />
                      </span>
                    </div>

                    <p className="mono-path" title={location}>
                      {middleTruncate(location, 24, 18)}
                    </p>

                    <div className="metadata-row">
                      <span className="manifest-tag">{project.services.length} services</span>
                      <span className="manifest-tag">{project.runtimeKind}</span>
                      <span className="manifest-tag" title={stale ? staleHint : "Docker was reachable when this project was last checked."}>
                        {dockerStatus?.daemonAvailable ? "reachable" : "stale"}
                      </span>
                    </div>

                    <div className="project-card__foot">
                      <span className="metadata-note">{project.contextName}</span>
                      <span className="metadata-note">{project.lastUpdatedLabel}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <section className="recent-strip">
          <div className="recent-strip__header">
            <p className="eyebrow">Recent Sources</p>
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
                    className="recent-item recent-item--button mono-path"
                    title={recent}
                    onClick={() => onOpenRecent(recent)}
                    disabled={pending}
                  >
                    {pending ? <LoaderCircle size={14} className="busy spin" /> : null}
                    <span>{middleTruncate(recent, 26, 18)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
