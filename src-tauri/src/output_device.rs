use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub label: String,
    pub is_default: bool,
}

#[tauri::command]
pub fn list_audio_output_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        return list_windows_devices();
    }
    #[cfg(target_os = "macos")]
    {
        return list_macos_devices();
    }
    #[cfg(target_os = "linux")]
    {
        return list_linux_devices();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
    }
}

#[cfg(target_os = "windows")]
fn list_windows_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create device enumerator: {}", e))?;

        let collection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("Failed to enumerate endpoints: {}", e))?;

        let default_id = match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
            Ok(d) => match d.GetId() {
                Ok(s) => s.to_string().unwrap_or_default(),
                Err(_) => String::new(),
            },
            Err(_) => String::new(),
        };

        let mut result = Vec::new();
        let count = collection
            .GetCount()
            .map_err(|e| format!("Failed to get device count: {}", e))?;

        for i in 0..count {
            let device = match collection.Item(i) {
                Ok(d) => d,
                Err(_) => continue,
            };

            let id_str = match device.GetId() {
                Ok(s) => s.to_string().unwrap_or_default(),
                Err(_) => continue,
            };

            let mut label = format!("Audio Device {}", i + 1);

            // Try to get friendly name from property store
            if let Ok(props) = device.OpenPropertyStore(STGM_READ) {
                // PKEY_Device_FriendlyName = { a45c254e-df08-4fd3-b6da-ea9e8b3f5b0e }, 14
                let pkey = windows::core::GUID::from_u128(0xa45c254e_df08_4fd3_b6da_ea9e8b3f5b0e);
                let propkey = windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY {
                    fmtid: pkey,
                    pid: 14,
                };
                if let Ok(prop) = props.GetValue(&propkey) {
                    if let Ok(s) = prop.to_string() {
                        label = s;
                    }
                }
            }

            let is_default = id_str == default_id;

            result.push(AudioDeviceInfo {
                id: id_str,
                label,
                is_default,
            });
        }

        // If nothing flagged as default, mark first active device
        if !result.is_empty() && !result.iter().any(|d| d.is_default) {
            result[0].is_default = true;
        }

        Ok(result)
    }
}

#[cfg(target_os = "macos")]
fn list_macos_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    use std::process::Command;

    let output = Command::new("system_profiler")
        .args(["SPAudiDataType"])
        .output()
        .map_err(|e| format!("Failed to run system_profiler: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut result = Vec::new();

    let mut idx = 0;
    for line in stdout.lines() {
        let trimmed = line.trim();
        // Lines with devices are often indented; skip headers/separators
        if !trimmed.is_empty()
            && !trimmed.contains(':')
            && !trimmed.starts_with("Audio")
            && !trimmed.starts_with("Devices")
        {
            result.push(AudioDeviceInfo {
                id: format!("macos-{idx}"),
                label: trimmed.to_string(),
                is_default: idx == 0,
            });
            idx += 1;
        }
    }

    if result.is_empty() {
        result.push(AudioDeviceInfo {
            id: "default".to_string(),
            label: "System Default Output".to_string(),
            is_default: true,
        });
    }

    Ok(result)
}

#[cfg(target_os = "linux")]
fn list_linux_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    use std::process::Command;

    // Try PulseAudio (pactl) first
    if let Ok(output) = Command::new("pactl")
        .args(["list", "short", "sinks"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut result = Vec::new();
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() >= 2 {
                    let id = parts[0].to_string();
                    let name = parts[1];
                    let label = parts.get(2).filter(|s| !s.is_empty()).unwrap_or(name);
                    let is_default = parts.len() >= 4
                        && parts[3].contains("RUNNING");
                    result.push(AudioDeviceInfo {
                        id: format!("pulse-{id}"),
                        label: label.to_string(),
                        is_default,
                    });
                }
            }
            if !result.is_empty() {
                if !result.iter().any(|d| d.is_default) {
                    result[0].is_default = true;
                }
                return Ok(result);
            }
        }
    }

    // Try PipeWire (wpctl) next
    if let Ok(output) = Command::new("wpctl")
        .args(["status"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut result = Vec::new();
            // Parse "Audio/Sinks:" section looking for device lines
            let mut in_sinks = false;
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.contains("Sinks:") {
                    in_sinks = true;
                    continue;
                }
                if in_sinks {
                    if trimmed.is_empty() || trimmed.ends_with(':') {
                        if !result.is_empty() {
                            break;
                        }
                        continue;
                    }
                    // Format: *<id>. <name> [vol: ...] (or similar)
                    let cleaned = trimmed.trim_start_matches('*').trim();
                    if let Some(dot_pos) = cleaned.find('.') {
                        let id_part = &cleaned[..dot_pos];
                        let name_part = cleaned[dot_pos + 1..].trim();
                        // strip anything after the first paren
                        let label = name_part.split('(').next().unwrap_or(name_part).trim();
                        let is_default = trimmed.starts_with('*');
                        result.push(AudioDeviceInfo {
                            id: format!("pipewire-{id_part}"),
                            label: label.to_string(),
                            is_default,
                        });
                    }
                }
            }
            if !result.is_empty() {
                if !result.iter().any(|d| d.is_default) {
                    result[0].is_default = true;
                }
                return Ok(result);
            }
        }
    }

    // Fallback
    Ok(vec![AudioDeviceInfo {
        id: "default".to_string(),
        label: "System Default Output".to_string(),
        is_default: true,
    }])
}
