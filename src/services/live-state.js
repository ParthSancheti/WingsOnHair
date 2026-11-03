import { PRESETS } from './protocol.js';

/** The accessory's telemetry is the source of truth while connected. */
export function reconcileWingTelemetry(settings, telemetry) {
  if (telemetry.mode === 6) return { settings, running: telemetry.running, mode: telemetry.mode };
  const mode = telemetry.mode || telemetry.selectedMode || settings.mode;
  const preset = PRESETS.find(item => item.mode === mode);
  const candidate = {
    ...(settings.mode === mode ? settings : preset || settings),
    mode,
    minAngle: telemetry.minAngle ?? (preset?.minAngle ?? settings.minAngle),
    maxAngle: telemetry.maxAngle ?? (preset?.maxAngle ?? settings.maxAngle),
    speed: telemetry.speed,
    impulseX: telemetry.impulseX,
    impulseY: telemetry.impulseY,
  };
  const nextSettings = ['mode', 'minAngle', 'maxAngle', 'speed', 'impulseX', 'impulseY'].some(key => settings[key] !== candidate[key]) ? candidate : settings;
  return { settings: nextSettings, running: telemetry.running, mode: telemetry.mode };
}
