import type { AppSettings, ThemeMode } from "../shared/contracts";

type ConfigurationPanelProps = {
  settings: AppSettings;
  onUpdate(settings: Partial<AppSettings>): void;
  onClearRecents(): void;
};

const THEME_OPTIONS: ThemeMode[] = ["dark", "light", "system"];
const SAMPLE_OPTIONS: Array<number | null> = [3, 5, 10, null];

export function ConfigurationPanel({ settings, onUpdate, onClearRecents }: ConfigurationPanelProps) {
  return (
    <section className="settings-stack">
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
  );
}
