interface AuthEntry {
  accessToken: string;
  email?: string;
  expiresAtMs: number;
  updatedAt: string;
}

const DEFAULT_CONNECTOR_KEY = 'default';
const tokenStore = new Map<string, AuthEntry>();

export function setAuthorizedGoogleToken(params: {
  key?: string;
  accessToken: string;
  email?: string;
  expiresInSeconds?: number;
}): void {
  const key = params.key?.trim() || DEFAULT_CONNECTOR_KEY;
  const ttlSec = params.expiresInSeconds && params.expiresInSeconds > 60
    ? params.expiresInSeconds
    : 3300;
  const entry: AuthEntry = {
    accessToken: params.accessToken,
    email: params.email,
    expiresAtMs: Date.now() + ttlSec * 1000,
    updatedAt: new Date().toISOString(),
  };
  tokenStore.set(key, entry);
  if (key !== DEFAULT_CONNECTOR_KEY) {
    tokenStore.set(DEFAULT_CONNECTOR_KEY, entry);
  }
}

export function getAuthorizedGoogleToken(key?: string): AuthEntry | null {
  const candidates = key ? [key.trim(), DEFAULT_CONNECTOR_KEY] : [DEFAULT_CONNECTOR_KEY];
  for (const k of candidates) {
    const entry = tokenStore.get(k);
    if (!entry) continue;
    if (Date.now() >= entry.expiresAtMs - 30_000) {
      tokenStore.delete(k);
      continue;
    }
    return entry;
  }
  return null;
}

export function clearAuthorizedGoogleToken(key?: string): void {
  if (key) {
    tokenStore.delete(key.trim());
  } else {
    tokenStore.clear();
  }
}

export function getAuthBridgeSummary(key?: string): {
  connected: boolean;
  email?: string;
  expiresInSeconds?: number;
} {
  const entry = getAuthorizedGoogleToken(key);
  if (!entry) return { connected: false };
  return {
    connected: true,
    email: entry.email,
    expiresInSeconds: Math.max(0, Math.round((entry.expiresAtMs - Date.now()) / 1000)),
  };
}
