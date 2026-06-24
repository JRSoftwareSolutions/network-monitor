const WINDOW_MINUTES_KEY = "nm:windowMinutes";

export function loadWindowMinutes(allowed: number[], fallback: number): number {
  try {
    const raw = localStorage.getItem(WINDOW_MINUTES_KEY);
    if (raw === null) {
      return fallback;
    }
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || !allowed.includes(minutes)) {
      return fallback;
    }
    return minutes;
  } catch {
    return fallback;
  }
}

export function saveWindowMinutes(minutes: number): void {
  try {
    localStorage.setItem(WINDOW_MINUTES_KEY, String(minutes));
  } catch {
    // quota exceeded or storage disabled
  }
}
