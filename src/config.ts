export const DEFAULT_VISION_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_VISION_MODEL = "gpt-4o-mini";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_LOCAL_IMAGE_BYTES = 20 * 1024 * 1024;

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function envNumber(name: string, fallback: number): number {
  const value = env(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function compactRecord<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null)
  ) as Partial<T>;
}
