import { muscleLabel, type Settings } from './protocol';

export type Muscle = Settings['muscle'];
export type ChannelId = 1 | 2;
/**
 * Physical electrode placement per sensor channel. This is app configuration only:
 * it decides which `muscle` is sent with calibrate/reset for the chosen channel.
 * Saved sessions keep their own `snapshot.settings.muscle`, so editing this later
 * never rewrites history.
 */
export type ChannelMap = { 1: Muscle; 2: Muscle; configured: boolean };

export const CHANNEL_MAP_KEY = 'semg-channel-map';
export const DEFAULT_CHANNEL_MAP: ChannelMap = { 1: 'forearm', 2: 'biceps', configured: false };

const isMuscle = (v: unknown): v is Muscle => v === 'forearm' || v === 'biceps';
const other = (m: Muscle): Muscle => (m === 'forearm' ? 'biceps' : 'forearm');

/**
 * Stored map wins. Without one, an existing user's saved settings are respected
 * (their chosen muscle stays on their chosen channel). Only brand-new installs get
 * the suggested CH1 = forearm, CH2 = biceps.
 */
export function resolveChannelMap(storedMap: string | null, storedSettings: string | null): ChannelMap {
  try {
    const parsed = storedMap ? JSON.parse(storedMap) : null;
    if (parsed && isMuscle(parsed[1]) && isMuscle(parsed[2])) return { 1: parsed[1], 2: parsed[2], configured: parsed.configured !== false };
  } catch { /* fall through */ }
  try {
    const legacy = storedSettings ? JSON.parse(storedSettings) : null;
    if (legacy && isMuscle(legacy.muscle) && (legacy.channel === 1 || legacy.channel === 2)) {
      const ch = legacy.channel as ChannelId;
      return ch === 1 ? { 1: legacy.muscle, 2: other(legacy.muscle), configured: false } : { 1: other(legacy.muscle), 2: legacy.muscle, configured: false };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_CHANNEL_MAP };
}

/** Settings for a session on `channel`, with the muscle taken from the current map. */
export const withChannel = (s: Settings, map: ChannelMap, channel: ChannelId = s.channel): Settings => ({ ...s, channel, muscle: map[channel] });

export const channelText = (channel: ChannelId, muscle: Muscle) => `CH${channel} · ${muscleLabel(muscle)}`;
