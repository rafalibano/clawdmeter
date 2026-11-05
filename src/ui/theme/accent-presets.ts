export interface AccentPreset {
  name: string;
  color: string;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { name: 'Índigo', color: '#6366f1' },
  { name: 'Azul', color: '#3b82f6' },
  { name: 'Verde', color: '#22c55e' },
  { name: 'Laranja', color: '#f97316' },
  { name: 'Rosa', color: '#ec4899' },
  { name: 'Roxo', color: '#a855f7' },
];

export const BACKGROUND_PRESETS: readonly AccentPreset[] = [
  { name: 'Branco', color: '#ffffff' },
  { name: 'Cinza claro', color: '#f5f5f7' },
  { name: 'Areia', color: '#fdf6e3' },
  { name: 'Grafite', color: '#1c1c1e' },
  { name: 'Azul noite', color: '#0f172a' },
  { name: 'Preto', color: '#000000' },
];
