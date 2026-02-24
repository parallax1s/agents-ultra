import { describe, expect, it } from 'vitest';

import {
  detectCoarsePointer,
  getSystemReducedMotion,
  normalizeUiSettings,
} from '../src/ui/ui-settings';

type MatchMediaResult = {
  matches: boolean;
  media: string;
  addEventListener: () => void;
  removeEventListener: () => void;
  addListener: () => void;
  removeListener: () => void;
};

const createMatchMedia = (matchesByQuery: Record<string, boolean>): ((query: string) => MatchMediaResult) => {
  return (query: string) => ({
    matches: matchesByQuery[query] ?? false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });
};

describe('ui-settings normalization', () => {
  it('keeps explicit booleans and applies defaults for invalid values', () => {
    const settings = normalizeUiSettings({
      showHud: false,
      reducedMotion: true,
      showSvgs: false,
      unrelated: 123,
    });

    expect(settings).toEqual({
      showHud: false,
      reducedMotion: true,
      showSvgs: false,
      showTutorialHints: false,
      runtimePlanLoop: false,
    });

    const fallbackSettings = normalizeUiSettings({
      showHud: 'false',
      reducedMotion: 0,
      showSvgs: null,
    }, {
      reducedMotionDefault: true,
    });

    expect(fallbackSettings).toEqual({
      showHud: true,
      reducedMotion: true,
      showSvgs: true,
      showTutorialHints: false,
      runtimePlanLoop: false,
    });
  });

  it('uses provided reduced-motion default when no setting is present', () => {
    const settings = normalizeUiSettings({}, {
      reducedMotionDefault: true,
    });

    expect(settings.reducedMotion).toBe(true);
    expect(settings.showHud).toBe(true);
    expect(settings.showSvgs).toBe(true);
  });

  it('reads reduced-motion system preference as default when matchMedia supports it', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = createMatchMedia({
      '(prefers-reduced-motion: reduce)': true,
    }) as typeof window.matchMedia;

    expect(getSystemReducedMotion()).toBe(true);

    window.matchMedia = originalMatchMedia;
  });

  it('falls back to false when matchMedia is unavailable', () => {
    const originalMatchMedia = window.matchMedia;
    // @ts-expect-error - test environment compatibility path
    window.matchMedia = undefined;

    expect(detectCoarsePointer()).toBe(false);
    expect(getSystemReducedMotion()).toBe(false);

    window.matchMedia = originalMatchMedia;
  });

  it('detects coarse pointer support from either pointer type or hover queries', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = createMatchMedia({
      '(pointer: coarse)': false,
      '(hover: none)': true,
    }) as typeof window.matchMedia;

    expect(detectCoarsePointer()).toBe(true);

    window.matchMedia = originalMatchMedia;
  });
});
