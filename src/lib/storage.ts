import { AppError } from "./errors";

export function loadStoredValue<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : (JSON.parse(stored) as T);
  } catch (error) {
    throw new AppError("STORAGE_FAILED", `Could not read stored value "${key}".`, {
      cause: error,
    });
  }
}

export function storeValue(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    throw new AppError("STORAGE_FAILED", `Could not save value "${key}".`, {
      cause: error,
    });
  }
}

export function removeStoredValue(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    throw new AppError("STORAGE_FAILED", `Could not remove value "${key}".`, {
      cause: error,
    });
  }
}
