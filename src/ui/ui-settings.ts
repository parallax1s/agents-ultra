export const UI_SETTINGS_STORAGE_KEY = 'agents-ultra-ui-settings-v1';

export type UiSettings = {
  showHud: boolean;
  reducedMotion: boolean;
  showSvgs: boolean;
  showTutorialHints: boolean;
  runtimePlanLoop: boolean;
};

const DEFAULT_SETTINGS: Readonly<UiSettings> = {
  showHud: true,
  reducedMotion: false,
  showSvgs: true,
  showTutorialHints: false,
  runtimePlanLoop: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const getRecordBoolean = (value: unknown): boolean | null => {
  return typeof value === 'boolean' ? value : null;
};

export const getSystemReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const normalizeUiSettings = (
  raw: unknown,
  options?: {
    reducedMotionDefault?: boolean;
  },
): UiSettings => {
  const record = isRecord(raw) ? raw : null;
  const reducedMotionDefault = options?.reducedMotionDefault ?? getSystemReducedMotion();

  return {
    showHud: getRecordBoolean(record?.showHud) ?? DEFAULT_SETTINGS.showHud,
    reducedMotion: getRecordBoolean(record?.reducedMotion) ?? reducedMotionDefault,
    showSvgs: getRecordBoolean(record?.showSvgs) ?? DEFAULT_SETTINGS.showSvgs,
    showTutorialHints: getRecordBoolean(record?.showTutorialHints) ?? DEFAULT_SETTINGS.showTutorialHints,
    runtimePlanLoop: getRecordBoolean(record?.runtimePlanLoop) ?? DEFAULT_SETTINGS.runtimePlanLoop,
  };
};

export const detectCoarsePointer = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  try {
    return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
  } catch {
    return false;
  }
};
