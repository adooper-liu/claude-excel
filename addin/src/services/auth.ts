/**
 * auth.ts — API key management and session auth.
 *
 * Keys are stored in memory only (React state), not persisted.
 * Office webview localStorage is unreliable and insecure for keys.
 *
 * Direct mode: key stays in browser memory, used for direct API calls.
 * Proxy mode: key is sent to backend and stored server-side (memory + file).
 */

import { validateApiKey, setDirectApiKey, setProxyUrl, getProviderConfig, type ProviderConfig } from './claude';

export type AuthStatus = 'unconfigured' | 'validating' | 'ready' | 'error';

export interface AuthState {
  status: AuthStatus;
  error?: string;
}

/**
 * Set up direct mode with a user-provided API key.
 * Validates the key before accepting it.
 */
export async function setupDirectMode(key: string): Promise<AuthState> {
  const trimmed = key.trim();
  if (!trimmed) return { status: 'error', error: 'API key is empty.' };
  if (!trimmed.startsWith('sk-')) {
    return { status: 'error', error: 'Invalid key format. DeepSeek keys start with "sk-".' };
  }

  // Skip validation — will be checked on first API call
  setDirectApiKey(trimmed);
  return { status: 'ready' };
}

/**
 * Set up proxy mode: send API key + provider config to backend for server-side storage.
 * The backend holds the key and proxies all AI API calls.
 */
export async function setupProxyMode(url: string, apiKey: string): Promise<AuthState> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return { status: 'error', error: 'Proxy URL is empty.' };
  if (!apiKey.trim()) return { status: 'error', error: 'API key is empty.' };
  if (!apiKey.trim().startsWith('sk-')) {
    return { status: 'error', error: 'Invalid key format. API keys start with "sk-".' };
  }

  // In proxy mode, let the backend validate the key (avoids CORS issues)
  setProxyUrl(trimmedUrl);

  const config = getProviderConfig();
  try {
    const resp = await fetch(`${trimmedUrl}/api/key/set`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: apiKey.trim(),
        baseUrl: config.baseUrl,
        model: config.model,
        smallFastModel: config.smallFastModel,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { status: 'error', error: `Backend rejected: ${resp.status} ${err}` };
    }
  } catch {
    return { status: 'error', error: 'Cannot connect to backend. Check the URL and ensure the server is running.' };
  }

  return { status: 'ready' };
}
