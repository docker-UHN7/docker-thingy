import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { ContainerStats, DriftFinding, ImageUpdateInfo, ServiceNodeModel } from "../shared/contracts";

type InspectorProps = {
  service: ServiceNodeModel;
  uptimeLabel: string;
  stats?: ContainerStats | undefined;
  statsHistory?: ContainerStats[];
  drift?: DriftFinding[];
};

const SPARKLINE_WIDTH = 72;
const SPARKLINE_HEIGHT = 20;

/** A small inline trend line over the last N percent samples (0-100) - makes "slowly climbing" visible between polls instead of just the instantaneous number. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return null;
  }

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * SPARKLINE_WIDTH;
      const y = SPARKLINE_HEIGHT - (Math.max(0, Math.min(100, value)) / 100) * SPARKLINE_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`} width={SPARKLINE_WIDTH} height={SPARKLINE_HEIGHT}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ImageUpdateCheck({ image }: { image: string }) {
  const [info, setInfo] = useState<ImageUpdateInfo | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [notApplicable, setNotApplicable] = useState(false);

  async function check() {
    setChecking(true);
    setNotApplicable(false);
    try {
      const result = await window.dockerExplorer.checkImageUpdate(image);
      if (result.ok && result.data.info) {
        setInfo(result.data.info);
      } else {
        setNotApplicable(true);
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="stat-block">
      <p className="stat-label">Image updates</p>
      {info ? (
        <p className="mono-value" title={info.remoteDigest ?? ""}>
          {info.updateAvailable ? "Update available on Docker Hub" : "Up to date"}
        </p>
      ) : notApplicable ? (
        <p className="mono-value">Not a plain Docker Hub image, or the tag couldn't be resolved.</p>
      ) : (
        <button className="link-button" onClick={() => void check()} disabled={checking}>
          {checking ? <RefreshCw size={12} className="busy spin" /> : null} Check for update
        </button>
      )}
    </div>
  );
}

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

export function Inspector({ service, uptimeLabel, stats, statsHistory = [], drift = [] }: InspectorProps) {
  const runtime = service.details?.runtimeState;
  const resources = service.details?.resources;
  const restartPolicy = resources?.restartPolicyName || "none";
  const retryCount =
    resources?.restartRetryCount && resources.restartRetryCount > 0 ? ` (${resources.restartRetryCount} retries)` : "";
  const networkSummary = service.categories.networks.join(", ") || "network data available once running";
  const exitStatus = runtime?.running ? "n/a (running)" : runtime?.exitCode !== undefined ? `exit ${runtime.exitCode}` : "not available";
  const latestHealthLog = runtime?.healthLog?.at(-1);
  const cpuHistory = statsHistory.map((entry) => entry.cpuPercent).filter((value): value is number => value !== undefined);
  const memHistory = statsHistory.map((entry) => entry.memoryPercent).filter((value): value is number => value !== undefined);

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

      {drift.length > 0 ? (
        <div className="detail-card detail-card--error">
          <p className="stat-label">Config drift</p>
          {drift.map((finding, index) => (
            <p key={index} className="mono-value">
              <TriangleAlert size={12} /> {finding.field}: compose declares "{finding.declared}", running container has "
              {finding.actual}"
            </p>
          ))}
        </div>
      ) : null}

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
          <Sparkline values={cpuHistory} />
        </div>
        <div className="stat-block">
          <p className="stat-label">Memory usage</p>
          <p className="mono-value">{formatMemoryUsage(stats)}</p>
          <Sparkline values={memHistory} />
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
        {service.image ? <ImageUpdateCheck image={service.image} /> : null}
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
