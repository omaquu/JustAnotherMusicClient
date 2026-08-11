import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { getAppSetting, setAppSetting } from "../../../internal/appSettings";
import { logInternalInfo, logInternalWarn } from "../../../internal/logging";

const SETTINGS_KEY = "plugin.output-device.settings.v1";
const CHANGE_EVENT = "output-device-store-change";

export interface AudioDeviceInfo {
  id: string;
  label: string;
  /** Whether the device is the system default output. */
  isDefault: boolean;
}

export interface OutputDeviceSettings {
  outputDevice: string | null;
}

const listeners = new Set<() => void>();
const DEFAULT_SETTINGS: OutputDeviceSettings = {
  outputDevice: "default",
};

let settings: OutputDeviceSettings = { ...DEFAULT_SETTINGS };
let devices: AudioDeviceInfo[] = [];
let available = false;
let applying = false;
let lastApplyError: string | null = null;

function emit(): void {
  for (const listener of listeners) listener();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): OutputDeviceSettings {
  return settings;
}

export function getOutputDeviceSettings(): OutputDeviceSettings {
  return settings;
}

export function useOutputDeviceSettings(): OutputDeviceSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getOutputDevices(): AudioDeviceInfo[] {
  return devices;
}

export function useOutputDevices(): AudioDeviceInfo[] {
  return useSyncExternalStore(
    subscribe,
    getOutputDevices,
    getOutputDevices,
  );
}

export function isOutputDeviceAvailable(): boolean {
  return available;
}

export function useOutputDeviceAvailable(): boolean {
  return useSyncExternalStore(subscribe, isOutputDeviceAvailable, () => false);
}

export function isApplyingOutputDevice(): boolean {
  return applying;
}

export function useApplyingOutputDevice(): boolean {
  return useSyncExternalStore(
    subscribe,
    isApplyingOutputDevice,
    () => false,
  );
}

export function getOutputDeviceApplyError(): string | null {
  return lastApplyError;
}

export function useOutputDeviceApplyError(): string | null {
  return useSyncExternalStore(
    subscribe,
    getOutputDeviceApplyError,
    () => null,
  );
}

function readSettingsFromStorage(): OutputDeviceSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    return {
      outputDevice:
        typeof parsed.outputDevice === "string" && parsed.outputDevice.trim()
          ? parsed.outputDevice
          : null,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(next: OutputDeviceSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  void setAppSetting(SETTINGS_KEY, next);
}

export async function hydrateOutputDeviceStore(): Promise<void> {
  const durable = await getAppSetting<OutputDeviceSettings>(SETTINGS_KEY);
  if (durable && typeof durable === "object" && durable.outputDevice) {
    settings = {
      outputDevice:
        typeof durable.outputDevice === "string"
          ? durable.outputDevice
          : "default",
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } else {
    settings = readSettingsFromStorage();
  }
  emit();
  await refreshOutputDevices();
}

export async function refreshOutputDevices(): Promise<void> {
  try {
    const result = await invoke<AudioDeviceInfo[]>("list_audio_output_devices");
    devices = result;
    available = true;
    logInternalInfo("output-device.refresh succeeded", {
      count: devices.length,
    });
  } catch (error) {
    logInternalWarn("output-device.refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback: use mediaDevices.enumerateDevices when Tauri command unavailable
    try {
      const mediaDevices = navigator.mediaDevices;
      if (mediaDevices?.enumerateDevices) {
        const list = await mediaDevices.enumerateDevices();
        devices = list
          .filter((d) => d.kind === "audiooutput")
          .map((d) => ({
            id: d.deviceId || "default",
            label: d.label || "Unknown device",
            isDefault: d.deviceId === "default",
          }));
        available = true;
      } else {
        available = false;
      }
    } catch {
      available = false;
    }
  }
  emit();
}

export async function setOutputDevice(deviceId: string): Promise<void> {
  applying = true;
  lastApplyError = null;
  emit();

  try {
    const next = { outputDevice: deviceId };
    writeSettings(next);
    settings = next;
    window.dispatchEvent(
      new CustomEvent("output-device-change", { detail: { deviceId } }),
    );
    logInternalInfo("output-device.set", { deviceId });
  } catch (error) {
    lastApplyError = error instanceof Error ? error.message : String(error);
  } finally {
    applying = false;
    emit();
  }
}

export function getSelectedOutputDevice(): string | null {
  return settings.outputDevice;
}
