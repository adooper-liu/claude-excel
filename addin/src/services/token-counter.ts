/**
 * token-counter.ts — Fast client-side token estimation.
 *
 * Uses heuristic: ~3.8 characters per token (Claude avg).
 * For accurate counts, the backend calls POST /v1/messages/count_tokens.
 */

const CHARS_PER_TOKEN = 3.8;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateTokensForMessages(messages: Array<{ content: string }>): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content);
  }
  // Add overhead for message structure (~4 tokens per message)
  total += messages.length * 4;
  return total;
}

/**
 * Check if content fits within a model's context window.
 * Returns { fits: boolean, tokens: number, limit: number }.
 */
export function checkTokenLimit(
  text: string,
  modelLimit: number = 200_000,
): { fits: boolean; tokens: number; limit: number } {
  const tokens = estimateTokens(text);
  return { fits: tokens < modelLimit, tokens, limit: modelLimit };
}
