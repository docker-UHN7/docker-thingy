import type { ServiceNodeModel } from "../shared/contracts";

type InspectorProps = {
  service: ServiceNodeModel;
  uptimeLabel: string;
};

function formatMemory(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return "no limit set";
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

function formatCpu(nanoCpus: number | undefined): string {
  if (!nanoCpus || nanoCpus <= 0) {
    return "no limit set";
  }

  return `${(nanoCpus / 1_000_000_000).toFixed(2)} CPU`;
}

export function Inspector({ service, uptimeLabel }: InspectorProps) {
  const runtime = service.details?.runtimeState;
  const resources = service.details?.resources;
  const restartPolicy = resources?.restartPolicyName || "none";
  const retryCount =
    resources?.restartRetryCount && resources.restartRetryCount > 0 ? ` (${resources.restartRetryCount} retries)` : "";
  const networkSummary = service.categories.networks.join(", ") || "network data available once running";
  const exitStatus = runtime?.running ? "n/a (running)" : runtime?.exitCode !== undefined ? `exit ${runtime.exitCode}` : "not available";

  return (
    <div className="detail-stack">
      <div className="detail-card">
        <div className="detail-card__head">
          <span className={`status-dot status-dot--${service.status === "unhealthy" ? "error" : service.status}`} />
          <span className="panel-title">{service.name}</span>
        </div>
        <p className="mono-value">
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
          <p className="mono-value">{service.portMappings.map((entry) => entry.label).join(", ") || "none"}</p>
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
          <p className="stat-label">Uptime</p>
          <p className="mono-value">{uptimeLabel}</p>
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
    </div>
  );
}
