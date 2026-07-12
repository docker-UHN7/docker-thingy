import { useEffect, useState } from "react";
import type { AppSettings, ThemeMode } from "../shared/contracts";
import type { RemoteAccessStatus } from "../shared/remote-access-contracts";

type ConfigurationPanelProps = {
  settings: AppSettings;
  onUpdate(settings: Partial<AppSettings>): void;
  onClearRecents(): void;
};

const THEME_OPTIONS: ThemeMode[] = ["dark", "light", "system"];
const SAMPLE_OPTIONS: Array<number | null> = [3, 5, 10, null];
const DEFAULT_REMOTE_PORT = 8443;

function RemoteAccessSection() {
  const [status, setStatus] = useState<RemoteAccessStatus>({ enabled: false, detectedAddresses: [] });
  const [port, setPort] = useState(DEFAULT_REMOTE_PORT);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void window.dockerExplorer.getRemoteAccessStatus().then((current) => {
      setStatus(current);
      if (current.enabled) {
        setPort(current.port);
        setHost(current.host);
      } else if (current.detectedAddresses[0]) {
        setHost(current.detectedAddresses[0].address);
      }
    });
  }, []);

  const withBusyGuard = (action: () => Promise<RemoteAccessStatus>, failureMessage: string) => {
    return async () => {
      setBusy(true);
      setError(undefined);
      try {
        const next = await action();
        setStatus(next);
        if (next.enabled) {
          setHost(next.host);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : failureMessage);
      } finally {
        setBusy(false);
      }
    };
  };

  const handleEnable = withBusyGuard(
    () => window.dockerExplorer.enableRemoteAccess(port, host),
    "Failed to enable remote access."
  );
  const handleDisable = withBusyGuard(() => window.dockerExplorer.disableRemoteAccess(), "Failed to disable remote access.");
  const handleRegenerate = withBusyGuard(
    () => window.dockerExplorer.regenerateRemoteAccessToken(),
    "Failed to regenerate the access token."
  );
  const handleUpdateHost = withBusyGuard(
    () => window.dockerExplorer.setRemoteAccessHost(host),
    "Failed to update the advertised address."
  );

  const handleCopy = (url: string) => {
    void window.dockerExplorer
      .copyToClipboard(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to copy the URL.");
      });
  };

  return (
    <section className="settings-stack">
      <div className="card__header">
        <div>
          <p className="eyebrow">Remote Access</p>
          <h3 className="panel-title">Reach this app from another machine</h3>
        </div>
      </div>

      {!status.enabled ? (
        <div className="settings-field">
          <label className="eyebrow" htmlFor="remote-port">
            Port
          </label>
          <input
            id="remote-port"
            className="settings-input"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(Number(event.target.value) || DEFAULT_REMOTE_PORT)}
          />
        </div>
      ) : null}

      <div className="settings-field">
        <label className="eyebrow" htmlFor="remote-host">
          Address to advertise
        </label>
        <input
          id="remote-host"
          className="settings-input"
          type="text"
          placeholder="LAN IP, Tailscale IP, public IP, or DDNS name"
          value={host}
          onChange={(event) => setHost(event.target.value)}
        />
        {status.detectedAddresses.length > 0 ? (
          <p className="body-copy--secondary">
            Detected:{" "}
            {status.detectedAddresses.map((candidate, index) => (
              <span key={`${candidate.interfaceName}-${candidate.address}`}>
                {index > 0 ? ", " : ""}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setHost(candidate.address)}
                  title={`Use ${candidate.address} (${candidate.interfaceName})`}
                >
                  {candidate.address} ({candidate.interfaceName})
                </button>
              </span>
            ))}
            . The server itself always listens on every interface - this only changes which address the shown URL
            uses, so pick whichever one your other machine can actually reach (e.g. a Tailscale address, or a public
            IP/DDNS name if you've port-forwarded).
          </p>
        ) : null}
      </div>

      {error ? <p className="toolbar-note toolbar-note--error">{error}</p> : null}

      {status.enabled ? (
        <>
          <div className="daemon-banner">
            <div className="daemon-banner__copy">
              <span className="status-dot status-dot--warning" />
              <span>
                Anyone with this URL and network access to this machine gets full control over projects,
                containers, VMs, and network isolation - only enable this on a trusted network or over a VPN. Your
                browser will warn about the certificate the first time you connect; that's expected for a
                self-signed cert, verify the port matches what's shown here before accepting it.
              </span>
            </div>
          </div>

          <div className="settings-field">
            <label className="eyebrow">Access URL</label>
            <div className="mono-path">{status.enabled ? status.url : ""}</div>
          </div>

          <button className="button button--secondary" onClick={() => handleCopy(status.url)}>
            {copied ? "Copied" : "Copy URL"}
          </button>
          <button className="button button--secondary" onClick={() => void handleUpdateHost()} disabled={busy}>
            Update address
          </button>
          <button className="button button--secondary" onClick={() => void handleRegenerate()} disabled={busy}>
            Regenerate token
          </button>
          <button className="button button--danger" onClick={() => void handleDisable()} disabled={busy}>
            Disable remote access
          </button>
        </>
      ) : (
        <button className="button button--primary" onClick={() => void handleEnable()} disabled={busy}>
          Enable remote access
        </button>
      )}
    </section>
  );
}

export function ConfigurationPanel({ settings, onUpdate, onClearRecents }: ConfigurationPanelProps) {
  return (
    <>
      <section className="settings-stack">
        <div className="card__header">
          <div>
            <p className="eyebrow">Settings</p>
            <h3 className="panel-title">Workspace controls</h3>
          </div>
        </div>

        <div className="settings-field">
          <label className="eyebrow" htmlFor="theme-mode">
            Theme
          </label>
          <select
            id="theme-mode"
            className="settings-select"
            value={settings.themeMode}
            onChange={(event) => onUpdate({ themeMode: event.target.value as ThemeMode })}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-field">
          <label className="eyebrow" htmlFor="stats-poll">
            Live stats interval
          </label>
          <select
            id="stats-poll"
            className="settings-select"
            value={settings.statsPollSeconds === null ? "manual" : String(settings.statsPollSeconds)}
            onChange={(event) =>
              onUpdate({
                statsPollSeconds: event.target.value === "manual" ? null : Number(event.target.value)
              })
            }
          >
            {SAMPLE_OPTIONS.map((option) => (
              <option key={String(option)} value={option === null ? "manual" : String(option)}>
                {option === null ? "manual only" : `${option}s`}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-field">
          <label className="eyebrow" htmlFor="log-lines">
            Log tail lines
          </label>
          <input
            id="log-lines"
            className="settings-input"
            type="number"
            min={50}
            max={2000}
            step={50}
            value={settings.logTailLines}
            onChange={(event) => onUpdate({ logTailLines: Number(event.target.value) || 200 })}
          />
        </div>

        <button className="button button--secondary" onClick={onClearRecents}>
          Clear recent sources
        </button>
      </section>

      <RemoteAccessSection />
    </>
  );
}
