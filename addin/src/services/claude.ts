/**
 * ai-provider.ts — Multi-provider AI API calling layer.
 *
 * Supports any Anthropic-compatible API endpoint (DeepSeek, Qwen, GLM, MiniMax, etc.)
 *
 * Two modes:
 *   DIRECT  — fetch API directly from browser (BYOK)
 *   PROXY   — fetch through backend server (config sent to backend)
 */

export type ApiMode = 'direct' | 'proxy';

export interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  stream?: boolean;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  smallFastModel: string;
}

const API_VERSION = '2023-06-01';

// Default config (DeepSeek)
const DEFAULT_CONFIG: ProviderConfig = {
  baseUrl: 'https://api.deepseek.com/anthropic',
  model: 'deepseek-v4-pro[1m]',
  smallFastModel: 'deepseek-v4-flash',
};

let apiMode: ApiMode = 'proxy';
let directApiKey = '';
let proxyBaseUrl = 'https://localhost:8765';
let providerConfig: ProviderConfig = { ...DEFAULT_CONFIG };

// ── Mode ──────────────────────────────────────────────────────

export function setMode(mode: ApiMode): void { apiMode = mode; }
export function getMode(): ApiMode { return apiMode; }

// ── Direct mode ───────────────────────────────────────────────

export function setDirectApiKey(key: string): void { directApiKey = key; }

// ── Proxy mode ────────────────────────────────────────────────

export function setProxyUrl(url: string): void { proxyBaseUrl = url; }

// ── Provider config ───────────────────────────────────────────

export function setProviderConfig(config: ProviderConfig): void {
  providerConfig = { ...config };
}

export function getProviderConfig(): ProviderConfig {
  return { ...providerConfig };
}

export function setBaseUrl(url: string): void { providerConfig.baseUrl = url; }
export function setModel(model: string): void { providerConfig.model = model; }
export function setSmallFastModel(model: string): void { providerConfig.smallFastModel = model; }

// ── API Key Validation ────────────────────────────────────────

/**
 * Validate an API key against the configured provider's models endpoint.
 */
export async function validateApiKey(key: string): Promise<boolean> {
  try {
    const resp = await fetch(`${providerConfig.baseUrl}/v1/models`, {
      headers: {
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Send a chat completion request to Claude.
 * Returns the full text response, or streams via onToken.
 */
export async function chat(
  messages: ClaudeMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const {
    model = providerConfig.model,
    maxTokens = 4096,
    systemPrompt,
    stream = true,
    signal,
    onToken,
  } = options;

  if (apiMode === 'direct') {
    return chatDirect(messages, { model, maxTokens, systemPrompt, stream, signal, onToken });
  }
  return chatProxy(messages, { model, maxTokens, systemPrompt, stream, signal, onToken });
}

/**
 * Direct mode: fetch Anthropic API from the browser.
 */
async function chatDirect(
  messages: ClaudeMessage[],
  opts: {
    model: string;
    maxTokens: number;
    systemPrompt?: string;
    stream: boolean;
    signal?: AbortSignal;
    onToken?: (t: string) => void;
  },
): Promise<string> {
  if (!directApiKey) throw new Error('No API key set. Configure in Settings.');

  // Build system message content
  const systemContent: string[] = [];
  if (opts.systemPrompt) systemContent.push(opts.systemPrompt);

  // Filter to just user/assistant for the messages array
  const apiMessages = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    messages: apiMessages,
    stream: opts.stream,
  };
  if (systemContent.length > 0) {
    body.system = systemContent.map(s => ({ type: 'text', text: s }));
  }

  const apiUrl = `${providerConfig.baseUrl}/v1/messages`;
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': directApiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`AI API error ${resp.status}: ${err}`);
  }

  if (opts.stream && opts.onToken) {
    return readStream(resp, opts.onToken);
  }

  const data = await resp.json();
  return data.content?.[0]?.text ?? JSON.stringify(data);
}

/**
 * Proxy mode: fetch through backend server.
 */
async function chatProxy(
  messages: ClaudeMessage[],
  opts: {
    model: string;
    maxTokens: number;
    systemPrompt?: string;
    stream: boolean;
    signal?: AbortSignal;
    onToken?: (t: string) => void;
  },
): Promise<string> {
  const resp = await fetch(`${proxyBaseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.systemPrompt,
      stream: opts.stream,
    }),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Proxy error ${resp.status}: ${err}`);
  }

  if (opts.stream && opts.onToken) {
    return readStream(resp, opts.onToken);
  }

  const data = await resp.json();
  return data.content?.[0]?.text ?? data.text ?? JSON.stringify(data);
}

/**
 * Read an SSE stream from a Response, calling onToken for each text delta.
 */
async function readStream(resp: Response, onToken: (token: string) => void): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6);
      if (dataStr === '[DONE]') continue;

      try {
        const data = JSON.parse(dataStr);
        // Anthropic SSE format: { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } }
        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
          const token = data.delta.text;
          fullText += token;
          onToken(token);
        }
        // Proxy may send plain text deltas
        if (typeof data === 'string') {
          fullText += data;
          onToken(data);
        }
        if (data.text && typeof data.text === 'string') {
          fullText += data.text;
          onToken(data.text);
        }
      } catch {
        // Non-JSON line (comment, heartbeat), ignore
      }
    }
  }

  return fullText;
}

/**
 * Estimate tokens for a string. Rough heuristic: ~3.8 chars per token.
 * For accurate counts, use POST /v1/messages/count_tokens server-side.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.8);
}

// ── Agentic Tool-Use Loop ──────────────────────────────

export interface ToolDef {
  name: string; description: string;
  input_schema: { type: 'object'; properties: Record<string, { type: string; description: string }>; required?: string[] };
}

export interface ToolCall { id: string; name: string; input: Record<string, unknown>; }

export interface AgentCallbacks {
  onToken?: (t: string) => void;
  onToolUse?: (tc: ToolCall) => Promise<string>;
  onThinking?: (t: string) => void;
  signal?: AbortSignal;
}

export async function chatWithTools(
  systemPrompt: string, userMessage: string, tools: ToolDef[], cb: AgentCallbacks,
): Promise<string> {
  const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: userMessage }];
  let text = ''; const maxIter = 10;
  for (let i = 0; i < maxIter; i++) {
    const body: Record<string, unknown> = { model: providerConfig.model, max_tokens: 4096, messages, tools, stream: false };
    if (systemPrompt) body.system = systemPrompt;
    let data: Record<string, unknown>;
    if (apiMode === 'direct') {
      if (!directApiKey) throw new Error('No API key');
      const r = await fetch(providerConfig.baseUrl + '/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': directApiKey, 'anthropic-version': API_VERSION },
        body: JSON.stringify(body), signal: cb.signal,
      });
      if (!r.ok) throw new Error('API error ' + r.status);
      data = await r.json();
    } else {
      const r = await fetch(proxyBaseUrl + '/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: cb.signal,
      });
      if (!r.ok) throw new Error('Proxy error ' + r.status);
      data = await r.json();
    }
    const content = data.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
    if (!content) break;
    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    const texts: string[] = [];
    for (const b of content) {
      if (b.type === 'text' && b.text) { texts.push(b.text); cb.onToken?.(b.text); }
      if (b.type === 'tool_use' && b.name && b.id) toolUses.push({ id: b.id, name: b.name, input: b.input || {} });
    }
    text = texts.join('');
    if (toolUses.length === 0) break;
    messages.push({ role: 'assistant', content });
    const results: Array<{ type: string; tool_use_id: string; content: string }> = [];
    for (const tc of toolUses) {
      cb.onThinking?.('🔧 ' + tc.name + '(' + JSON.stringify(tc.input).slice(0, 80) + ')');
      try { results.push({ type: 'tool_result', tool_use_id: tc.id, content: cb.onToolUse ? await cb.onToolUse(tc) : 'OK' }); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: tc.id, content: 'Error: ' + e }); }
    }
    messages.push({ role: 'user', content: results });
  }
  return text || '(no response)';
}
