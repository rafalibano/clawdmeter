import { isHexColor } from '../../domain/settings';

export function readableTextOn(background: string): string {
  if (!isHexColor(background)) return '#1c1c1e';
  const [red, green, blue] = [1, 3, 5].map((start) => parseInt(background.slice(start, start + 2), 16));
  const luminance = (0.299 * red! + 0.587 * green! + 0.114 * blue!) / 255;
  return luminance > 0.6 ? '#1c1c1e' : '#f5f5f7';
}
