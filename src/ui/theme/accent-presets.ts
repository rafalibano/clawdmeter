export interface AccentPreset {
  name: string;
  color: string;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { name: 'Verde Mottu', color: '#00b131' },
  { name: 'Verde vivo', color: '#1bd60b' },
  { name: 'Verde escuro', color: '#006e1b' },
  { name: 'Azul', color: '#0063f7' },
  { name: 'Laranja', color: '#ef6800' },
  { name: 'Grafite', color: '#4f4f4f' },
];

export const BACKGROUND_PRESETS: readonly AccentPreset[] = [
  { name: 'Branco', color: '#ffffff' },
  { name: 'Cinza claro', color: '#f7f7f7' },
  { name: 'Cinza', color: '#eeeeee' },
  { name: 'Grafite', color: '#272727' },
  { name: 'Componente', color: '#121212' },
  { name: 'Preto', color: '#000000' },
];
