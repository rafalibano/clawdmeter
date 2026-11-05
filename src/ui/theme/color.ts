import { isHexColor } from '../../domain/settings';
import { MOTTU } from './mottu-tokens';

const DARK_TEXT = MOTTU.neutral.extraDark;
const LIGHT_TEXT = MOTTU.neutral.white;

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => channel(parseInt(hex.slice(start, start + 2), 16)));
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

export function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

export function readableTextOn(background: string): string {
  if (!isHexColor(background)) return DARK_TEXT;
  return contrastRatio(background, DARK_TEXT) >= contrastRatio(background, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}

export function parseHexInput(text: string): string | null {
  const digits = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(digits)) {
    return `#${[...digits].map((digit) => digit + digit).join('')}`.toLowerCase();
  }
  return /^[0-9a-f]{6}$/i.test(digits) ? `#${digits}`.toLowerCase() : null;
}
