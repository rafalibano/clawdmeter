import type { MessageKey } from '../i18n/pt-BR';

export interface AccentPreset {
  name: MessageKey;
  color: string;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { name: 'preset.mottuGreen', color: '#00b131' },
  { name: 'preset.vividGreen', color: '#1bd60b' },
  { name: 'preset.darkGreen', color: '#006e1b' },
  { name: 'preset.blue', color: '#0063f7' },
  { name: 'preset.orange', color: '#ef6800' },
  { name: 'preset.graphite', color: '#4f4f4f' },
];

export const SERIES_PRESETS: readonly AccentPreset[] = [
  ...ACCENT_PRESETS,
  { name: 'preset.mediumGray', color: '#767676' },
];

export const BACKGROUND_PRESETS: readonly AccentPreset[] = [
  { name: 'preset.white', color: '#ffffff' },
  { name: 'preset.lightGray', color: '#f7f7f7' },
  { name: 'preset.gray', color: '#eeeeee' },
  { name: 'preset.graphite', color: '#272727' },
  { name: 'preset.component', color: '#121212' },
  { name: 'preset.black', color: '#000000' },
];
