import React, { useState, useRef, useCallback, useEffect } from 'react';
import { chatWithTools, type ToolCall } from '../../services/claude';
import { getAllTools } from '../../services/skill-loader';
import { selectToolsForRequest } from '../../services/tools-for-request';
import { executeHandler } from '../../services/skill-handlers';
import * as Excel from '../../excel';
import { selectionToMarkdown } from '../../services/context';
import { type AuthStatus } from '../../services/auth';
import SettingsPanel from './SettingsPanel';
import SelectionBadge from './SelectionBadge';
import ChatPanel from './ChatPanel';
import ChatInput from './ChatInput';
import { parseSlashCommand, skillAsk, mergeSlashSkills } from '../../services/slash-skills';
import { fetchUserSkills, installUserSkill, type InstalledSkill } from '../../services/user-skills';
import { calculateSkill, reconcileSkill, reshapeSkill, skillifySkill } from '../../services/builtin-skills';
import { extractSkillMarkdown } from '../../services/skill-md';
import HistoryPanel from './HistoryPanel';
import TokenBadge from './TokenBadge';
import { addUsage, type TokenUsage } from '../../services/token-meter';
import type { SheetRecord } from '../../excel/sheet-history';
import {
  isSkipSampleRequest,
  sampleKitsForAsk,
  sampleActionForText,
  askGenerateSample,
  SKIP_SAMPLE_REPLY,
  type SampleKit,
} from '../../excel/intent-guard';

export interface ToolStep {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  ms?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  hasTable?: boolean;
  steps?: ToolStep[];
  samplePrompt?: { kits: SampleKit[] };
}

const SYSTEM_PROMPT = `You are an Excel AI agent inside an add-in.

These tools ARE available in this session: inspect_workbook, inspect_table, ensure_table, reconcile_tables, reshape_table, calculate_table, web_fetch. DeepSeek also has server-side web_search (injected by the proxy). Never say they are missing or unavailable.

For product lookup ("获取产品数据" / Amazon / ASIN / 商品页): web_search first if there is no URL, then web_fetch on a concrete link. If fetch errors (Amazon often 403), use search snippets only and mark missing fields 未能获取. Never invent prices, ratings, or ASINs. Write results to a new sheet only. Never paste web_search JSON, encrypted_content, or raw tool payloads into the user-visible reply — cite title and URL only.

## How to work
For matching, reconciling, or "对账" two lists:
1. inspect_workbook — see sheets, Tables, headers. Use each sheet's \`range\` field (A1:D6), not the sheet-qualified usedAddress.
2. If the workbook is empty or has no headed data: if the user asked to 生成/随机/准备样例, CREATE small sample tables with write_to_sheet (headers + a few rows). Otherwise reply in Chinese with exactly: 「当前工作簿没有带表头的表。请勾选要生成的样例后点确认。」 The UI adds checkboxes — do not list sample schemas, do not ask them to type 生成, and do not invent business data.
3. If a range is not an Excel Table yet, ensure_table. range may be omitted (uses the sheet's used range) or A1:D6. Use the returned \`name\` as leftTable/rightTable (Chinese names become T_系统订单表).
4. reconcile_tables with leftTable, rightTable, and keys (e.g. "订单号"). This WRITES A NEW SHEET only.
Exact match after trim. Blank keys never match. No fuzzy matching.
Never simulate reconcile with write_to_sheet. If a tool fails, retry with the returned table names; do not invent comparison results.

For cleaning a dirty table ("去重" / "反透视" / "拆列" / "转数字"):
1. inspect_workbook then ensure_table on the source sheet.
2. reshape_table with op dedupe|unpivot|split|coerce. WRITES A NEW SHEET only. Never overwrite the source.
Never fake reshape with write_to_sheet.
If empty / no headed table: same short checkbox ask as above.

For live formulas ("求和" / "匹配过来" / "修#REF"):
1. inspect_workbook then ensure_table.
2. calculate_table with op lookup|sumifs|fix_ref. WRITES A NEW SHEET of formulas (INDEX/MATCH / SUMIFS), never paste computed totals.
Never fake calculate with write_to_sheet.
If empty / no headed table: same short checkbox ask as above.
If the user asked to generate sample data AND test these: first write 订单 (订单号,类别,金额) and 流水 (订单号,金额); on a third sheet 公式源 write a formula containing #REF!; ensure_table; then calculate_table for sumifs, lookup, and fix_ref. Always pass sheetName to write_to_sheet. After the three calculate_table calls succeed, STOP calling tools and reply in Chinese with the new sheet names. Never paste computed totals.

For other requests, use the existing read/write/format tools. Prefer Tables over raw A1 ranges when possible.

## Output
Be concise. Respond in the user's language. After reconcile, report the four counts and the new sheet name. After reshape or calculate, report the new sheet name and that formulas stay live.`;

const SKILL_BODY: Record<string, string> = {
  reconcile: reconcileSkill,
  reshape: reshapeSkill,
  calculate: calculateSkill,
  skillify: skillifySkill,
};

function systemForTurn(skillId?: string, skillBody?: string): string {
  const body = skillBody || (skillId ? SKILL_BODY[skillId] : "");
  if (!body) return SYSTEM_PROMPT;
  return (
    SYSTEM_PROMPT +
    "\n\n## Active skill\n" +
    body +
    "\nFollow this skill this turn. Inspect live headers. Do not assume column names like 订单号 or 类别."
  );
}

function withSamplePrompt(assistantText: string, userText: string): Pick<Message, "content" | "samplePrompt"> {
  const kits = sampleKitsForAsk(assistantText, userText);
  if (!kits) return { content: assistantText };
  return {
    content: askGenerateSample(sampleActionForText(userText)),
    samplePrompt: { kits },
  };
}

// ── App ────────────────────────────────────────────────────────

export default function App(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('unconfigured');
  const [showSettings, setShowSettings] = useState(false);
  const [checkingConfig, setCheckingConfig] = useState(true);
  const [selection, setSelection] = useState<{ address: string; rows: number; cols: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const msgIdRef = useRef(0);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const installedRef = useRef<InstalledSkill[]>([]);
  installedRef.current = installed;
  const nextMsgId = () => {
    msgIdRef.current += 1;
    return String(msgIdRef.current);
  };

  // Check saved config on startup
  useEffect(() => {
    const check = async () => {
      const wasConnected = localStorage.getItem('claude_excel_configured');
      if (wasConnected === 'true') {
        try {
          const r = await fetch('https://localhost:8765/api/config');
          const c = await r.json();
          if (c.hasKey) { setAuthStatus('ready'); setCheckingConfig(false); return; }
        } catch { /* fall through */ }
        setAuthStatus('ready'); setCheckingConfig(false); return;
      }
      try {
        const r = await fetch('https://localhost:8765/api/config');
        const c = await r.json();
        if (c.hasKey) { localStorage.setItem('claude_excel_configured', 'true'); setAuthStatus('ready'); setCheckingConfig(false); return; }
      } catch { /* no backend */ }
      setShowSettings(true); setCheckingConfig(false);
    };
    Office.onReady(() => check());
  }, []);

  // Poll selection
  useEffect(() => {
    let running = true; let lastAddr = '';
    const poll = async () => {
      if (!running) return;
      try {
        const sel = await Excel.readSelection();
        if (sel.address !== lastAddr && sel.rowCount > 0) { lastAddr = sel.address; setSelection({ address: sel.address, rows: sel.rowCount, cols: sel.colCount }); }
      } catch { /* not ready */ }
      setTimeout(poll, 1000);
    };
    Office.onReady(() => poll());
    return () => { running = false; };
  }, []);

  useEffect(() => {
    fetchUserSkills().then(setInstalled).catch(() => { /* backend down */ });
  }, []);

  // Agentic chat
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || sendingRef.current) return;
    sendingRef.current = true;
    const uid = nextMsgId();
    const aid = nextMsgId();
    setMessages(prev => [...prev, { id: uid, role: 'user', content: text }, { id: aid, role: 'assistant', content: '' }]);
    setIsStreaming(true);
    const ac = new AbortController(); abortRef.current = ac;

    const ctx = { excel: Excel, showMessage: (t: string) => {
      setMessages(prev => [...prev, { id: nextMsgId(), role: 'tool', content: t }]);
    }};

    try {
      const catalog = installedRef.current;
      const slash = parseSlashCommand(text, catalog);
      if (!slash && isSkipSampleRequest(text)) {
        setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: SKIP_SAMPLE_REPLY } : m));
        return;
      }
      if (!slash) {
        if (Excel.isReconcileRequest(text)) {
          const final = await Excel.runReconcileIntent(text, ctx.showMessage);
          setMessages(prev => prev.map(m => m.id === aid ? { ...m, ...withSamplePrompt(final, text) } : m));
          return;
        }
        if (Excel.isReshapeRequest(text)) {
          const final = await Excel.runReshapeIntent(text, ctx.showMessage);
          setMessages(prev => prev.map(m => m.id === aid ? { ...m, ...withSamplePrompt(final, text) } : m));
          return;
        }
        if (Excel.isCalculateRequest(text)) {
          const final = await Excel.runCalculateIntent(text, ctx.showMessage);
          setMessages(prev => prev.map(m => m.id === aid ? { ...m, ...withSamplePrompt(final, text) } : m));
          return;
        }
      }
      let userText = slash ? skillAsk(slash.id, slash.extra) : text;
      if (slash?.id === "skillify") {
        const listed = mergeSlashSkills(catalog).map((s) => "/" + s.slash).join(" ");
        userText += " 现有斜杠：" + listed + "。";
      }
      const tools = selectToolsForRequest(userText, await getAllTools(), slash?.id);
      const skillBody = slash
        ? (SKILL_BODY[slash.id] || catalog.find((s) => s.id === slash.id)?.body)
        : undefined;
      let final = await chatWithTools(systemForTurn(slash?.id, skillBody), userText, tools, {
        signal: ac.signal,
        onToken: (t: string) => setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: m.content + t } : m)),
        onThinking: (t: string) => setMessages(prev => {
          const last = prev[prev.length - 1];
          return last?.role === 'tool' && !last.steps
            ? [...prev.slice(0, -1), { ...last, content: last.content + '\n' + t }]
            : [...prev, { id: nextMsgId(), role: 'tool', content: t }];
        }),
        onToolStep: (step) => {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (step.phase === 'start') {
              const next = { name: step.name, input: step.input };
              if (last?.role === 'tool' && last.steps) {
                return [...prev.slice(0, -1), { ...last, steps: [...last.steps, next] }];
              }
              return [...prev, { id: nextMsgId(), role: 'tool', content: '', steps: [next] }];
            }
            if (last?.role !== 'tool' || !last.steps || last.steps.length === 0) return prev;
            const steps = last.steps.slice();
            const i = steps.length - 1;
            steps[i] = { ...steps[i], result: step.result, ms: step.ms };
            return [...prev.slice(0, -1), { ...last, steps }];
          });
        },
        onToolUse: (tc: ToolCall) => executeHandler(tc, ctx),
        onUsage: (info) => setUsage((u) => addUsage(u, info.model, info.tokens)),
      });
      if (slash?.id === "skillify") {
        const md = extractSkillMarkdown(final);
        if (md) {
          try {
            const skill = await installUserSkill(md);
            setInstalled((prev) => prev.filter((s) => s.id !== skill.id).concat([skill]));
            final = String(final || "").trim() + "\n\n已安装，输入 /" + skill.slash + " 使用。";
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            final = String(final || "").trim() + "\n\n没有安装：" + msg;
          }
        }
      }
      const shown = withSamplePrompt(String(final || ""), userText);
      setMessages(prev => prev.map(m => m.id === aid ? {
        ...m,
        content: shown.samplePrompt ? shown.content : (m.content || final),
        samplePrompt: shown.samplePrompt,
        hasTable: String(final || "").includes('|---'),
      } : m));
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      const hint = /Failed to fetch|NetworkError|Load failed/i.test(msg)
        ? '后端连不上（https://localhost:8765）。请先运行 launch.bat，或单独执行：python backend/server.py'
        : msg;
      setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: `Error: ${hint}` } : m));
    } finally {
      sendingRef.current = false;
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, []);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);

  const handleAuthReady = useCallback(() => { localStorage.setItem('claude_excel_configured', 'true'); setAuthStatus('ready'); setShowSettings(false); }, []);

  const [usage, setUsage] = useState<TokenUsage>({ tokens: 0, byModel: {} });
  const [history, setHistory] = useState<SheetRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    const sync = () => setHistory(Excel.sheetHistory.list());
    sync();
    return Excel.sheetHistory.subscribe(sync);
  }, []);
  const handleUndoSheet = useCallback(async (sheet: string) => {
    try {
      await Excel.undoResultSheet(sheet);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    if (history.length === 0) setShowHistory(false);
  }, [history.length]);

  if (checkingConfig) return <div className="app-header" />;
  if (showSettings || authStatus === 'unconfigured') {
    return (
      <>
        <div className="app-header">
          <div className="header-meta">
            {authStatus === 'ready' && (
              <button className="icon-btn" onClick={() => setShowSettings(false)} title="关闭" aria-label="关闭">✕</button>
            )}
          </div>
        </div>
        <SettingsPanel onReady={handleAuthReady} />
      </>
    );
  }

  return <>
    <div className="app-header">
      <img className="header-logo" src="/assets/icon-32.png" alt="Mind for Sheet" width={22} height={22} />
      <SelectionBadge
        address={selection?.address}
        rows={selection?.rows}
        cols={selection?.cols}
      />
      <div className="header-meta">
        <TokenBadge usage={usage} />
        <div className="header-flyout">
          <button
            className="icon-btn"
            onClick={() => setShowHistory((v) => !v)}
            disabled={history.length === 0}
            title={history.length ? '操作历史' : '没有可撤销的结果表'}
            aria-label="操作历史"
          >↩</button>
          {showHistory && (
            <HistoryPanel
              items={history}
              onUndo={handleUndoSheet}
              onClose={() => setShowHistory(false)}
            />
          )}
        </div>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="设置" aria-label="设置">⚙</button>
      </div>
    </div>
    <ChatPanel
      messages={messages}
      skills={mergeSlashSkills(installed)}
      onPickSkill={handleSend}
      isStreaming={isStreaming}
    />
    <ChatInput
      onSend={handleSend}
      onStop={handleStop}
      isStreaming={isStreaming}
      disabled={false}
      installed={installed}
      onInstalledChange={setInstalled}
    />
  </>;
}
