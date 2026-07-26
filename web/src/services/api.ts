/**
 * api.ts — REST client for the Python backend.
 */

const BASE = '/api';

export async function uploadFile(file: File): Promise<{
  file_id: string; name: string; sheets: Record<string, unknown>; warnings: string[];
}> {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch(`${BASE}/upload`, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
  return resp.json();
}

export async function describeFile(fileId: string) {
  const resp = await fetch(`${BASE}/describe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  return resp.json();
}

export async function profileFile(fileId: string, columns?: string[]) {
  const resp = await fetch(`${BASE}/profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, columns }),
  });
  return resp.json();
}

export async function cleanFile(fileId: string, operations?: string[]) {
  const resp = await fetch(`${BASE}/clean`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, operations }),
  });
  return resp.json();
}

export async function compareFiles(fileIdA: string, fileIdB: string, keyColumns?: string[]) {
  const resp = await fetch(`${BASE}/compare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id_a: fileIdA, file_id_b: fileIdB, key_columns: keyColumns }),
  });
  return resp.json();
}

export async function validateKey(apiKey: string, baseUrl?: string) {
  const resp = await fetch(`${BASE}/key/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, baseUrl }),
  });
  return resp.json();
}

export async function saveConfig(config: Record<string, string>) {
  const resp = await fetch(`${BASE}/key/set`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!resp.ok) throw new Error(`Config save failed: ${resp.status}`);
  return resp.json();
}

export async function getConfig() {
  const resp = await fetch(`${BASE}/config`);
  return resp.json();
}

export function chatStreamUrl(): string {
  return `${BASE}/chat`;
}

export function downloadUrl(fileId: string): string {
  return `${BASE}/download/${fileId}`;
}
