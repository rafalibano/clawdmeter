import '@angular/compiler';
import { ApplicationRef, provideExperimentalZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings, type AppSettings } from '../../domain/settings';
import { SettingsFacade } from '../shell/settings.facade';
import { ThemeService } from './theme.service';

class FakeMedia {
  matches = false;
  private listener: ((event: { matches: boolean }) => void) | null = null;

  addEventListener(_type: string, listener: (event: { matches: boolean }) => void): void {
    this.listener = listener;
  }

  removeEventListener(): void {
    this.listener = null;
  }

  change(matches: boolean): void {
    this.matches = matches;
    this.listener?.({ matches });
  }

  get listening(): boolean {
    return this.listener !== null;
  }
}

describe('ThemeService', () => {
  let media: FakeMedia;
  let settings: ReturnType<typeof signal<AppSettings>>;
  let properties: Map<string, string>;
  let rootElement: { dataset: Record<string, string>; style: { setProperty(n: string, v: string): void; removeProperty(n: string): void } };

  const flush = () => TestBed.inject(ApplicationRef).tick();

  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    media = new FakeMedia();
    properties = new Map();
    rootElement = {
      dataset: {},
      style: {
        setProperty: (name, value) => void properties.set(name, value),
        removeProperty: (name) => void properties.delete(name),
      },
    };
    vi.stubGlobal('window', { matchMedia: () => media });
    vi.stubGlobal('document', { documentElement: rootElement });
    settings = signal(createDefaultSettings());
    TestBed.configureTestingModule({ providers: [provideExperimentalZonelessChangeDetection(), { provide: SettingsFacade, useValue: { settings } }] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('segue o esquema do sistema no modo system e aplica no documento', () => {
    const service = TestBed.inject(ThemeService);
    flush();
    expect(service.resolved()).toBe('light');
    expect(rootElement.dataset['theme']).toBe('light');
    media.change(true);
    flush();
    expect(service.resolved()).toBe('dark');
    expect(rootElement.dataset['theme']).toBe('dark');
  });

  it('ignora o sistema quando o tema é fixo e propaga o destaque', () => {
    const service = TestBed.inject(ThemeService);
    settings.update((current) => ({
      ...current,
      appearance: { ...current.appearance, theme: 'light', accentColor: '#ff0000' },
    }));
    media.change(true);
    flush();
    expect(service.resolved()).toBe('light');
    expect(properties.get('--dp-accent')).toBe('#ff0000');
  });

  it('para de ouvir o sistema ao ser destruído', () => {
    TestBed.inject(ThemeService);
    expect(media.listening).toBe(true);
    TestBed.resetTestingModule();
    expect(media.listening).toBe(false);
  });
});
