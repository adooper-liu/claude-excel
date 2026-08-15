/** Local chat sessions. Stored on this machine only; never sent to the model. */

export const SESSION_STORE_KEY = "claude_excel_chat_sessions";
export const MAX_SESSIONS = 30;
export const MAX_CONTENT = 2000;

export type StoredStep = {
  name: string;
  input?: Record<string, unknown>;
  ms?: number;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  steps?: StoredStep[];
};

export type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: StoredMessage[];
};

const INPUT_KEEP = ["op", "sheetName", "tableName", "outputSheet", "column", "caseMode", "unique"];

export function newSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function compactToolInput(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const src = input || {};
  const out: Record<string, unknown> = {};
  INPUT_KEEP.forEach(function (k) {
    if (src[k] != null && String(src[k]) !== "") out[k] = src[k];
  });
  return out;
}

export function snapshotMessages(
  messages: Array<{
    id: string;
    role: string;
    content: string;
    steps?: Array<{ name: string; input?: Record<string, unknown>; ms?: number }>;
  }>
): StoredMessage[] {
  return (messages || [])
    .filter(function (m) {
      return m.role === "user" || m.role === "assistant" || m.role === "tool";
    })
    .map(function (m) {
      const stored: StoredMessage = {
        id: String(m.id),
        role: m.role as StoredMessage["role"],
        content: String(m.content || "").slice(0, MAX_CONTENT),
      };
      if (m.steps && m.steps.length) {
        stored.steps = m.steps.map(function (s) {
          return { name: s.name, input: compactToolInput(s.input), ms: s.ms };
        });
      }
      return stored;
    });
}

export function titleFromMessages(messages: Array<{ role: string; content: string }>): string {
  const u = (messages || []).find(function (m) {
    return m.role === "user" && String(m.content || "").trim();
  });
  if (!u) return "新会话";
  return String(u.content).replace(/\s+/g, " ").trim().slice(0, 24);
}

export function hasChatContent(messages: Array<{ role: string; content: string }>): boolean {
  return (messages || []).some(function (m) {
    return m.role === "user" && String(m.content || "").trim();
  });
}

export function upsertSession(list: ChatSession[], session: ChatSession): ChatSession[] {
  const rest = (list || []).filter(function (s) {
    return s.id !== session.id;
  });
  return [session].concat(rest).slice(0, MAX_SESSIONS);
}

export function removeSession(list: ChatSession[], id: string): ChatSession[] {
  return (list || []).filter(function (s) {
    return s.id !== id;
  });
}

export function parseSessionList(raw: string): ChatSession[] {
  try {
    const data = JSON.parse(raw || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter(function (s) {
      return s && typeof s.id === "string" && Array.isArray(s.messages);
    });
  } catch {
    return [];
  }
}

export function loadSessions(): ChatSession[] {
  try {
    return parseSessionList(localStorage.getItem(SESSION_STORE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSessions(list: ChatSession[]): void {
  try {
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(list.slice(0, MAX_SESSIONS)));
  } catch {
    /* quota */
  }
}

export function persistSession(messages: Parameters<typeof snapshotMessages>[0], id: string): ChatSession[] {
  if (!hasChatContent(messages)) return loadSessions();
  const session: ChatSession = {
    id: id,
    title: titleFromMessages(messages),
    updatedAt: Date.now(),
    messages: snapshotMessages(messages),
  };
  const next = upsertSession(loadSessions(), session);
  saveSessions(next);
  return next;
}

export function hydrateMessages(stored: StoredMessage[]): Array<{
  id: string;
  role: StoredMessage["role"];
  content: string;
  steps?: Array<{ name: string; input: Record<string, unknown>; ms?: number }>;
}> {
  return (stored || []).map(function (m) {
    const msg: {
      id: string;
      role: StoredMessage["role"];
      content: string;
      steps?: Array<{ name: string; input: Record<string, unknown>; ms?: number }>;
    } = { id: String(m.id), role: m.role, content: String(m.content || "") };
    if (m.steps && m.steps.length) {
      msg.steps = m.steps.map(function (s) {
        return { name: s.name, input: compactToolInput(s.input), ms: s.ms };
      });
    }
    return msg;
  });
}

export function maxMsgId(messages: Array<{ id: string }>): number {
  let n = 0;
  (messages || []).forEach(function (m) {
    const x = parseInt(String(m.id), 10);
    if (Number.isFinite(x) && x > n) n = x;
  });
  return n;
}

export function bootChat(): { id: string; messages: ReturnType<typeof hydrateMessages> } {
  const first = loadSessions()[0];
  if (first && first.messages && first.messages.length) {
    return { id: first.id, messages: hydrateMessages(first.messages) };
  }
  return { id: newSessionId(), messages: [] };
}
