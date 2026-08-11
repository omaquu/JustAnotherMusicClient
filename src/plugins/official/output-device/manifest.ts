import type { PluginManifest } from "../../pluginHost";
import { registerOfficialPlugin } from "../../pluginHost";

export const OUTPUT_DEVICE_PLUGIN_ID = "output-device";

export const outputDevicePluginManifest: PluginManifest = {
  schemaVersion: 1,
  id: OUTPUT_DEVICE_PLUGIN_ID,
  name: "Output Device",
  version: "1.0.0",
  kind: "official",
  entry: "index.js",
  requiresRestart: false,
  permissions: [],
  settings: [
    {
      key: "outputDevice",
      type: "select",
      label: "Audio output device",
      default: "default",
      options: [{ value: "default", label: "System default" }],
    },
    {
      key: "refreshDevices",
      type: "action",
      label: "Refresh device list",
      action: "refreshDevices",
    },
  ],
};

export function registerOutputDevicePlugin(): void {
  registerOfficialPlugin(outputDevicePluginManifest, false);
}
