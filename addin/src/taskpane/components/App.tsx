import React, { useState, useRef, useCallback, useEffect } from 'react';
import { getMode, chatWithTools, type ToolCall } from '../../services/claude';
import { getAllTools } from '../../services/skill-loader';
import { executeHandler } from '../../services/skill-handlers';
import * as Excel from '../../excel';
import { selectionToMarkdown } from '../../services/context';
import { type AuthStatus } from '../../services/auth';
import SettingsPanel from './SettingsPanel';
import SelectionBadge from './SelectionBadge';
import ChatPanel from './ChatPanel';
import ChatInput from './ChatInput';
import OneClickPanel from './OneClickPanel';

export interface Message {
  id: string; role: 'user' | 'assistant' | 'system' | 'tool'; content: string; hasTable?: boolean;
}

const SYSTEM_PROMPT = `You are an Excel AI agent — like Claude Code but for spreadsheets.
You run inside an Excel add-in with tools to read, write, format, chart, and analyze data.

## Core principles
- Work step by step: inspect → analyze → deliver.
- Use tools proactively — don't ask the user to copy data, read it yourself.
- When producing results, write them to the sheet.
- Always explain what you're doing briefly as you work.
- Be concise but thorough. Skip filler.

## Output
- Present analysis with clear markdown headings.
- Use markdown tables for structured results.
- Respond in the user's language (Chinese or English).`;

// ── App ────────────────────────────────────────────────────────

export default function App(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('unconfigured');
  const [showSettings, setShowSettings] = useState(false);
  const [checkingConfig, setCheckingConfig] = useState(true);
  const [selection, setSelection] = useState<{ address: string; rows: number; cols: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // Agentic chat
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;
    const uid = Date.now().toString();
    const aid = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: uid, role: 'user', content: text }, { id: aid, role: 'assistant', content: '' }]);
    setIsStreaming(true);
    const ac = new AbortController(); abortRef.current = ac;

    const ctx = { excel: Excel, showMessage: (t: string) => {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'tool', content: t }]);
    }};

    try {
      const final = await chatWithTools(SYSTEM_PROMPT, text, await getAllTools(), {
        signal: ac.signal,
        onToken: (t: string) => setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: m.content + t } : m)),
        onThinking: (t: string) => setMessages(prev => {
          const last = prev[prev.length - 1];
          return last?.role === 'tool' ? [...prev.slice(0, -1), { ...last, content: last.content + '\n' + t }] : [...prev, { id: Date.now().toString(), role: 'tool', content: t }];
        }),
        onToolUse: (tc: ToolCall) => executeHandler(tc, ctx),
      });
      setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: m.content || final, hasTable: final.includes('|---') } : m));
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return;
      setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: `Error: ${err}` } : m));
    } finally { setIsStreaming(false); abortRef.current = null; }
  }, [isStreaming]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);

  // Local operations (zero token)
  const handleLocalSort = useCallback(async (order: 'asc' | 'desc') => {
    try {
      const sel = await Excel.readSelection();
      if (!sel.rowCount) return;
      const col = String.fromCharCode(65 + (sel.colCount > 1 ? 0 : 0)); // A column's letter
      const sheet = (await Excel.getSheetNames())[0]; // active sheet — use readSelection address
      await Excel.applySortFilter(sheet, sel.address, 'sort', [{ column: col, order: order === 'asc' ? 'ascending' : 'descending' }]);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `已按 ${order === 'asc' ? '升序' : '降序'} 排列 ${sel.address}` }]);
    } catch (err) { setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `排序失败: ${err}` }]); }
  }, []);

  const handleLocalFormat = useCallback(async () => {
    try {
      const sel = await Excel.readSelection();
      if (!sel.rowCount) return;
      const names = await Excel.getSheetNames();
      await Excel.formatRange(names[0], sel.address, { bold: true });
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `已加粗 ${sel.address}` }]);
    } catch (err) { setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `格式化失败: ${err}` }]); }
  }, []);

  const handleLocalClean = useCallback(async () => {
    try {
      const sel = await Excel.readSelection();
      if (!sel.rowCount) return;
      const values = sel.values.map(row => row.map(c => typeof c === 'string' ? c.trim() : c));
      await Excel.writeToNewSheet('Cleaned', values);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `已清洗并写入新工作表 "Cleaned" (${sel.rowCount} 行)` }]);
    } catch (err) { setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `清洗失败: ${err}` }]); }
  }, []);

  const handleLocalDataBar = useCallback(async () => {
    try {
      const sel = await Excel.readSelection();
      if (!sel.rowCount) return;
      const names = await Excel.getSheetNames();
      await Excel.addConditionalFormat(names[0], sel.address, 'dataBar');
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `已添加数据条到 ${sel.address}` }]);
    } catch (err) { setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `条件格式失败: ${err}` }]); }
  }, []);

  const handleOneClick = useCallback(async (action: string) => {
    const prompts: Record<string, string> = {
      analyze: 'Read the selected data and provide a complete analysis: overview, key statistics, patterns, outliers, and data quality issues. Write findings to a new sheet called "Analysis".',
      report: 'Read the data, generate a comprehensive report. Create a new sheet "Report" with the report, format headers, and switch to it.',
    };
    if (prompts[action]) handleSend(prompts[action]);
  }, [handleSend]);

  const [skillsLoaded, setSkillsLoaded] = useState(0);
  useEffect(() => { getAllTools().then(t => setSkillsLoaded(t.length)); }, []);

  const handleAuthReady = useCallback(() => { localStorage.setItem('claude_excel_configured', 'true'); setAuthStatus('ready'); setShowSettings(false); }, []);

  if (checkingConfig) return <div className="app-header"><h1>🤖 Claude Excel Agent</h1></div>;
  if (showSettings || authStatus === 'unconfigured') return <><div className="app-header"><h1>🤖 Claude Excel Agent</h1></div><SettingsPanel onReady={handleAuthReady} /></>;

  return <>
    <div className="app-header">
      <h1>🤖 Claude Excel Agent</h1>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className={`mode-indicator ${getMode()}`}>{getMode() === 'direct' ? 'BYOK' : 'Proxy'}</span>
        <span style={{ fontSize: 10, color: '#999' }}>{skillsLoaded} tools</span>
        <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>⚙</button>
      </div>
    </div>
    {selection && <SelectionBadge address={selection.address} rows={selection.rows} cols={selection.cols} onClear={() => setSelection(null)} />}
    <OneClickPanel
      onAnalyze={() => handleOneClick('analyze')}
      onReport={() => handleOneClick('report')}
      onSortAsc={() => handleLocalSort('asc')}
      onSortDesc={() => handleLocalSort('desc')}
      onClean={handleLocalClean}
      onFormat={handleLocalFormat}
      onDataBar={handleLocalDataBar}
      disabled={isStreaming}
    />
    <ChatPanel messages={messages} />
    <ChatInput onSend={handleSend} onStop={handleStop} isStreaming={isStreaming} disabled={false} />
  </>;
}
