import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import {
  useOutputDevices,
  useOutputDeviceSettings,
  useOutputDeviceAvailable,
  useApplyingOutputDevice,
  refreshOutputDevices,
  setOutputDevice,
} from "../../plugins/official/output-device/outputDeviceStore";

interface OutputDevicePanelProps {
  styles: Record<string, string>;
  IconRefresh: ComponentType<{ size?: number }>;
}

/**
 * Inline settings panel rendered inside the Plugins tab of SettingsPage.
 * Lets the user pick which audio output device native (downloaded) audio plays through.
 * Uses the W3C setSinkId API via the AudioEngine — only works for HTMLAudioElement,
 * not the YouTube IFrame player.
 */
export function OutputDevicePanel({ styles, IconRefresh }: OutputDevicePanelProps) {
  const devices = useOutputDevices();
  const settings = useOutputDeviceSettings();
  const available = useOutputDeviceAvailable();
  const applying = useApplyingOutputDevice();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshOutputDevices();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshOutputDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const handleChange = (e: { target: { value: string } }) => {
    const deviceId = e.target.value;
    setError(null);
    void setOutputDevice(deviceId).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  const options = devices.map((d) => ({
    value: d.id,
    label: d.isDefault ? `${d.label} (Default)` : d.label,
  }));
  if (options.length === 0) {
    options.push({ value: "default", label: "System default" });
  }

  const currentValue = settings.outputDevice ?? "default";

  return (
    <div className={styles.pluginSettings}>
      <div className={styles.selectRow}>
        <span className={styles.toggleDescription}>
          <strong>Audio output device</strong>
          <span>
            {available
              ? "Routes downloaded audio to a specific output device. YouTube IFrame playback always uses the system default."
              : "Audio device selection is not available on this platform."}
          </span>
        </span>
        <select
          value={currentValue}
          disabled={applying}
          onChange={handleChange}
          style={{
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid var(--border-color, #444)",
            background: "var(--input-bg, #222)",
            color: "var(--text-primary, #fff)",
            fontSize: "14px",
            minWidth: "200px",
          }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.actionRow}>
        <span className={styles.toggleDescription}>
          <strong>Refresh device list</strong>
          <span>Re-scan for connected audio output devices.</span>
        </span>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={refreshing || applying}
          onClick={() => void handleRefresh()}
        >
          <IconRefresh size={18} />
          {refreshing ? "Scanning..." : "Refresh"}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
