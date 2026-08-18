/**
 * ai-provider.ts — Multi-provider AI API calling layer.
 *
 * Supports any Anthropic-compatible API endpoint (DeepSeek, Qwen, GLM, MiniMax, etc.)
 *
 * Two modes:
 *   DIRECT  — fetch API directly from browser (BYOK)
 *   PROXY   — fetch through backend server (config sent to backend)
 */

import { appendSummaryNudge, compactToolDigest, parseAssistantContent } from './agent-finish';
import { fromApiToolName, mapToolsForApi } from './tool-name-api';

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
    onToolStep?: (step: {
      phase: 'start' | 'end';
      name: string;
      input: Record<string, unknown>;
      result?: string;
      ms?: number;
    }) => void;
    onUsage?: (info: { model: string; tokens: number }) => void;
    signal?: AbortSignal;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

async function completeOnce(
  messages: Array<{ role: string; content: unknown }>,
  systemPrompt: string,
  tools: ToolDef[] | undefined,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { model: providerConfig.model, max_tokens: 4096, messages, stream: false };
  if (systemPrompt) body.system = systemPrompt;
  if (tools && tools.length) body.tools = mapToolsForApi(tools);
  if (apiMode === 'direct') {
    if (!directApiKey) throw new Error('No API key');
    const r = await fetch(providerConfig.baseUrl + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': directApiKey, 'anthropic-version': API_VERSION },
      body: JSON.stringify(body), signal,
    });
    if (!r.ok) throw new Error('API error ' + r.status);
    return r.json();
  }
  const r = await fetch(proxyBaseUrl + '/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal,
  });
  if (!r.ok) throw new Error('Proxy error ' + r.status);
  return r.json();
}

export async function chatWithTools(
  systemPrompt: string, userMessage: string, tools: ToolDef[], cb: AgentCallbacks,
): Promise<string> {
  const prior = (cb.history || []).filter((m) => m && m.content);
  const messages: Array<{ role: string; content: unknown }> = prior
    .map((m) => ({ role: m.role, content: m.content }))
    .concat([{ role: 'user', content: userMessage }]);
  let text = '';
  const digest: string[] = [];
  const maxIter = 20;
  for (let i = 0; i < maxIter; i++) {
    const data = await completeOnce(messages, systemPrompt, tools, cb.signal);
    cb.onUsage?.({
      model: providerConfig.model,
      tokens: estimateTokens(JSON.stringify({ systemPrompt, messages, tools, content: data.content })),
    });
    const parsed = parseAssistantContent(data.content);
    if (parsed.text) {
      text = parsed.text;
      cb.onToken?.(parsed.text);
    }
    if (parsed.toolUses.length === 0) {
      // 模型停在"汇报进度/计划"式文字上：本回合已执行过工具且文字像中途暂停 → 自动续，不用用户手动点「继续执行」
      if (
        digest.length &&
        /还没|尚未|未写完|未完成|未写出|还缺|还差|已执行.{0,8}步|第.{0,4}步|我这就继续|请回复|接着(做|执行|来)/.test(parsed.text)
      ) {
        messages.push({ role: 'assistant', content: data.content });
        messages.push({
          role: 'user',
          content:
            '你刚才只输出了中间状态，任务还没完成。不要再输出状态/计划文字，直接调用下一个工具继续执行（如 write_to_sheet 建校验表、write_formula 写公式、read_range 读回），全部做完后再一次性汇报结论。',
        });
        continue;
      }
      break;
    }
    messages.push({ role: 'assistant', content: data.content });
    const results: Array<{ type: string; tool_use_id: string; content: string }> = [];
    for (const raw of parsed.toolUses) {
      const tc = { ...raw, name: fromApiToolName(raw.name) };
      const t0 = Date.now();
      cb.onToolStep?.({ phase: 'start', name: tc.name, input: tc.input });
      if (!cb.onToolStep) cb.onThinking?.(toolPreview(tc.name, tc.input));
      try {
        const out = cb.onToolUse ? await cb.onToolUse(tc) : 'OK';
        const ms = Date.now() - t0;
        results.push({ type: 'tool_result', tool_use_id: tc.id, content: out });
        digest.push(tc.name + ' → ' + String(out).slice(0, 180));
        cb.onToolStep?.({ phase: 'end', name: tc.name, input: tc.input, result: out, ms: ms });
        if (!cb.onToolStep) cb.onThinking?.('   ' + String(out).slice(0, 180));
      } catch (e) {
        const err = 'Error: ' + e;
        const ms = Date.now() - t0;
        results.push({ type: 'tool_result', tool_use_id: tc.id, content: err });
        digest.push(tc.name + ' → ' + err);
        cb.onToolStep?.({ phase: 'end', name: tc.name, input: tc.input, result: err, ms: ms });
        if (!cb.onToolStep) cb.onThinking?.('   ' + err);
      }
    }
    messages.push({ role: 'user', content: results });
  }
  if (!text && digest.length) {
    appendSummaryNudge(messages);
    try {
      const data = await completeOnce(messages, systemPrompt, undefined, cb.signal);
      cb.onUsage?.({
        model: providerConfig.model,
        tokens: estimateTokens(JSON.stringify({ systemPrompt, messages, content: data.content })),
      });
      const parsed = parseAssistantContent(data.content);
      if (parsed.text) {
        text = parsed.text;
        cb.onToken?.(parsed.text);
      }
    } catch {
      /* fall through to compact digest */
    }
  }
  if (text) return text;
  if (digest.length) return compactToolDigest(digest);
  return '(no response)';
}

function toolPreview(name: string, input: Record<string, unknown>): string {
  const keys = ['op', 'sheetName', 'tableName', 'leftTable', 'rightTable', 'key', 'groupBy', 'valueColumn', 'outputSheet'];
  const bits: string[] = [];
  for (const k of keys) {
    if (input[k] != null && String(input[k]) !== '') bits.push(String(input[k]));
  }
  return '🔧 ' + name + (bits.length ? ' (' + bits.join(' · ') + ')' : '');
}
