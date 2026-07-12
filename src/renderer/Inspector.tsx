import type { ContainerStats, ServiceNodeModel } from "../shared/contracts";

type InspectorProps = {
  service: ServiceNodeModel;
  uptimeLabel: string;
  stats?: ContainerStats | undefined;
};

// Pure byte formatter, with no opinion on what "0" or "undefined" means -
// callers decide whether that's "no limit set" (a resource cap) or a real
// zero-byte reading (current usage).
export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined || bytes < 0 || Number.isNaN(bytes)) {
    return undefined;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatMemory(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return "no limit set";
  }

  return formatBytes(bytes) ?? "no limit set";
}

function formatCpu(nanoCpus: number | undefined): string {
  if (!nanoCpus || nanoCpus <= 0) {
    return "no limit set";
  }

  return `${(nanoCpus / 1_000_000_000).toFixed(2)} CPU`;
}

function formatCpuUsage(value: number | undefined): string {
  return value === undefined ? "not available" : `${value.toFixed(1)}%`;
}

function formatTimestamp(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toLocaleString();
}

export function formatMemoryUsage(stats: ContainerStats | undefined): string {
  if (!stats || stats.memoryUsageBytes === undefined) {
    return "not available";
  }

  const percent = stats.memoryPercent !== undefined ? ` (${stats.memoryPercent.toFixed(1)}%)` : "";
  return `${formatBytes(stats.memoryUsageBytes) ?? "0 B"}${percent}`;
}

export function Inspector({ service, uptimeLabel, stats }: InspectorProps) {
  const runtime = service.details?.runtimeState;
  const resources = service.details?.resources;
  const restartPolicy = resources?.restartPolicyName || "none";
  const retryCount =
    resources?.restartRetryCount && resources.restartRetryCount > 0 ? ` (${resources.restartRetryCount} retries)` : "";
  const networkSummary = service.categories.networks.join(", ") || "network data available once running";
  const exitStatus = runtime?.running ? "n/a (running)" : runtime?.exitCode !== undefined ? `exit ${runtime.exitCode}` : "not available";
  const latestHealthLog = runtime?.healthLog?.at(-1);
  const healthDetails = runtime?.healthLog?.filter(
    (entry) => entry.output || entry.exitCode !== undefined || entry.start || entry.end
  );

  return (
    <div className="detail-stack">
      <div className="detail-card">
        <div className="detail-card__head">
          <span className={`status-dot status-dot--${service.status === "unhealthy" ? "error" : service.status}`} />
          <span className="panel-title">{service.name}</span>
        </div>
        <p
          className="mono-value"
          title={service.image ?? service.sourceHints?.dockerfilePath ?? "image unresolved"}
        >
          {service.image ?? (service.sourceHints?.dockerfilePath ? `build: ${service.sourceHints.dockerfilePath}` : "image unresolved")}
        </p>
        <p className="body-copy body-copy--secondary">
          {service.dependencyDetails.length > 0
            ? `Depends on ${service.dependencyDetails.map((entry) => entry.serviceName).join(", ")}`
            : "No explicit dependencies declared"}
        </p>
      </div>

      <div className="stats-grid">
        <div className="stat-block">
          <p className="stat-label">Ports</p>
          <p className="mono-value" title={service.portMappings.map((entry) => entry.label).join(", ") || "none"}>
            {service.portMappings.map((entry) => entry.label).join(", ") || "none"}
          </p>
        </div>
        <div className="stat-block">
          <p className="stat-label">Restart policy</p>
          <p className="mono-value">{`${restartPolicy}${retryCount}`}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">Memory limit</p>
          <p className="mono-value">{formatMemory(resources?.memoryBytes)}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">CPU limit</p>
          <p className="mono-value">{formatCpu(resources?.nanoCpus)}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">CPU usage</p>
          <p className="mono-value">{formatCpuUsage(stats?.cpuPercent)}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">Memory usage</p>
          <p className="mono-value">{formatMemoryUsage(stats)}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">Health</p>
          <p className="mono-value">{runtime?.healthStatus ?? service.healthStatus ?? "not available"}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">Health retries</p>
          <p className="mono-value">{runtime?.healthFailingStreak ?? 0}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">Uptime</p>
          <p className="mono-value">{uptimeLabel}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">Last health check</p>
          <p className="mono-value">{formatTimestamp(latestHealthLog?.end ?? latestHealthLog?.start) ?? "not available"}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">Exit status</p>
          <p className="mono-value">{exitStatus}</p>
        </div>
        <div className="stat-block">
          <p className="stat-label">Networks</p>
          <p className="mono-value">{networkSummary}</p>
        </div>
      </div>

      {!runtime?.running && runtime?.error ? (
        <div className="detail-card detail-card--error">
          <p className="stat-label">Last error</p>
          <p className="mono-value">{runtime.error}</p>
        </div>
      ) : null}

      {healthDetails && healthDetails.length > 0 ? (
        <div className="detail-card">
          <p className="stat-label">{service.name} health logs</p>
          <div className="detail-table">
            {healthDetails.slice(-3).reverse().map((entry, index) => (
              <div key={`${entry.start ?? entry.end ?? "health"}:${index}`} className="detail-list__row detail-list__row--column">
                <div className="detail-row-main">
                  <span className="mono-key">
                    exit {entry.exitCode ?? "?"}
                  </span>
                  <span className="mono-value">
                    {formatTimestamp(entry.end ?? entry.start) ?? "time unavailable"}
                  </span>
                </div>
                <span className="mono-value" title={entry.output ?? "No output"}>
                  {entry.output?.trim() || "No healthcheck output from Docker."}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
