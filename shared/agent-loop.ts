/**
 * agent-loop.ts — Shared Agent loop for both Web and Excel.
 *
 * Platform-agnostic. Takes tools + executor + API config.
 * Repeats: send → parse tool_use → execute → send results → repeat.
 */

export interface ToolDef {
  name: string; description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}
export interface ToolCall { id: string; name: string; input: Record<string, unknown>; }
export interface AgentConfig {
  apiBase: string;         // e.g. 'https://api.deepseek.com/anthropic' or proxy URL
  apiKey: string;
  model: string;
  maxTokens?: number;
}

/** Run the agent loop. Calls fetchToolDefs() to get tools, executor() to run them. */
export async function runAgent(
  systemPrompt: string,
  userMessage: string,
  config: AgentConfig,
  fetchToolDefs: () => Promise<ToolDef[]>,
  executor: (tool: ToolCall) => Promise<string>,
  onText: (token: string) => void,
  onTool?: (name: string, input: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const tools = await fetchToolDefs();
  const messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: userMessage },
  ];
  let finalText = '';

  for (let iter = 0; iter < 10; iter++) {
    const body: Record<string, unknown> = {
      model: config.model, max_tokens: config.maxTokens || 4096,
      messages, tools, stream: false,
    };
    if (systemPrompt) body.system = systemPrompt;

    const isDirect = !config.apiBase.startsWith('/') && !config.apiBase.startsWith('http');
    const isProxyPath = config.apiBase.startsWith('/');
    const url = isDirect ? `${config.apiBase}/v1/messages` : config.apiBase;
    const headers: Record<string, string> = isDirect
      ? { 'content-type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
      : { 'content-type': 'application/json' };

    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();

    const content = data.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    if (!content || content.length === 0) break;

    const toolUses: ToolCall[] = [];
    for (const b of content) {
      if (b.type === 'text' && b.text) { finalText += b.text; onText(b.text); }
      if (b.type === 'tool_use' && b.name && b.id) toolUses.push({ id: b.id, name: b.name, input: b.input || {} });
    }

    if (toolUses.length === 0) break;

    messages.push({ role: 'assistant', content });
    const results: Array<{ type: string; tool_use_id: string; content: string }> = [];
    for (const tc of toolUses) {
      onTool?.(tc.name, JSON.stringify(tc.input).slice(0, 100));
      try { results.push({ type: 'tool_result', tool_use_id: tc.id, content: await executor(tc) }); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: tc.id, content: `Error: ${e}` }); }
    }
    messages.push({ role: 'user', content: results });
  }
  return finalText || '(no response)';
}
