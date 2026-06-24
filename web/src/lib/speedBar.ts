export const SPEED_BAR_MAX_MBPS = 1000;

export function speedBarPercent(mbps: number, maxMbps = SPEED_BAR_MAX_MBPS): number {
  if (maxMbps <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (mbps / maxMbps) * 100));
}
