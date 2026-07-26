import React, { useState, useRef, useCallback } from 'react';
import { uploadFile, cleanFile, downloadUrl, getConfig, profileFile } from './services/api';
import SettingsPanel from './components/SettingsPanel';
import { runAgent, type ToolCall } from '../../shared/agent-loop';

export interface Message { id: string; role: 'user' | 'assistant' | 'system' | 'tool'; content: string; }
interface FileInfo { fileId: string; name: string; sheets: Record<string, { rows: number; cols: number; column_names: string[]; sample_rows: Record<string, unknown>[] }>; warnings: string[]; }

const SYS = `You are a data analysis agent with tools. Work step-by-step: plan → use tools → interpret → present. Use tools proactively. Explain findings with markdown. Respond in user's language.`;

function fetchTools() { return fetch('/api/skills').then(r => r.json()).then(d => d.tools || []); }

export default function App(): JSX.Element {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [statData, setStatData] = useState<Record<string, unknown> | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [compareA, setCompareA] = useState(''); const [compareB, setCompareB] = useState('');
  const [compareResult, setCompareResult] = useState<Record<string, unknown> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  React.useEffect(() => { getConfig().then(c => setHasConfig(c.hasKey)).catch(() => {}); }, []);

  const loadData = useCallback(async (id: string) => {
    setActiveFile(id);
    try { setStatData(await profileFile(id)); } catch { /* */ }
  }, []);

  const handleUpload = useCallback(async (f: File) => {
    try {
      const raw = await uploadFile(f);
      const info: FileInfo = { fileId: raw.file_id, name: raw.name, sheets: raw.sheets as FileInfo['sheets'], warnings: raw.warnings };
      setFiles(prev => [...prev, info]);
      loadData(info.fileId);
    } catch { /* */ }
  }, [loadData]);

  // ── Tool Executor (platform-specific) ──────────────────────────
  const execTool = useCallback(async (tool: ToolCall): Promise<string> => {
    const aId = activeFile;
    const { name, input } = tool;
    try {
      switch (name) {
        case 'run_profile': {
          if (!aId) return 'No file loaded';
          const d = await profileFile(aId); setStatData(d);
          return JSON.stringify({ statistics: d.statistics, outliers: d.outlier_count });
        }
        case 'run_trend': {
          if (!aId) return 'No file loaded';
          const r = await fetch('/api/ops/trend', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ file_id:aId, date_column:input.date_column, metric_columns:input.metric_columns }) });
          return JSON.stringify((await r.json()).trends || []);
        }
        case 'run_pivot': {
          if (!aId) return 'No file loaded';
          const r = await fetch('/api/ops/pivot', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ file_id:aId, group_by:input.group_by, metric_columns:input.metric_columns||[] }) });
          return JSON.stringify((await r.json()).pivot || []);
        }
        case 'run_clean': {
          if (!aId) return 'No file loaded';
          const r = await cleanFile(aId); window.open(downloadUrl(r.file_id), '_blank');
          return JSON.stringify({ changes: r.changes, issues: r.issues_remaining });
        }
        case 'run_compare': {
          const r = await fetch('/api/compare', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input) });
          const d = await r.json(); setCompareResult(d);
          return JSON.stringify(d.values || {});
        }
        default: return `Unknown tool: ${name}`;
      }
    } catch(e) { return `Error: ${e}`; }
  }, [activeFile]);

  // ── AI Agent (Layer 2) ─────────────────────────────────────────
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    // Layer 1: /command (local, zero token)
    if (text.startsWith('/')) {
      const cmd = text.split(' ')[0].toLowerCase();
      const sys = (c: string) => setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: c }]);
      if (cmd === '/profile' && activeFile) { loadData(activeFile); sys('✅ 已刷新'); return; }
      if (cmd === '/clean' && activeFile) { try { const r = await cleanFile(activeFile); window.open(downloadUrl(r.file_id), '_blank'); sys('✅ 已下载'); } catch { sys('失败'); } return; }
      if (cmd === '/help') { sys('`/profile` `/clean` `/compare` `/trend` `/pivot` `/help`\n\n直接输入问题 = AI Agent 分析'); return; }
      sys(`未知: ${cmd}。输入 /help 查看列表`); return;
    }

    if (!hasConfig) { setShowSettings(true); return; }
    const active = files.find(f => f.fileId === activeFile);
    let ctx = '';
    if (active) {
      ctx = `\n\nActive file: ${active.name}\n`;
      const sheets = active.sheets || {};
      for (const [n, info] of Object.entries(sheets)) {
        ctx += `Sheet ${n}: ${info.rows}x${info.cols}, columns: ${(info.column_names||[]).join(', ')}\n`;
        if (info.sample_rows) ctx += `Sample:\n\`\`\`json\n${JSON.stringify(info.sample_rows,null,2)}\n\`\`\`\n`;
      }
      if (statData?.statistics) ctx += `Stats:\n\`\`\`json\n${JSON.stringify(statData.statistics,null,2)}\n\`\`\`\n`;
    }

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    const ac = new AbortController(); abortRef.current = ac;
    const msgId = Date.now().toString() + '_ai';

    try {
      await runAgent(SYS, text + ctx,
        { apiBase: '/api/chat', apiKey: '', model: '' },
        fetchTools, execTool,
        (t: string) => setMessages(prev => {
          const last = prev.find(m => m.id === msgId);
          if (last) return prev.map(m => m.id === msgId ? { ...m, content: m.content + t } : m);
          return [...prev, { id: msgId, role: 'assistant', content: t }];
        }),
        (name: string, input: string) => setMessages(prev => [...prev, { id: Date.now().toString(), role: 'tool', content: `🔧 ${name}(${input})` }]),
        ac.signal,
      );
    } catch (err) { if ((err as Error)?.name !== 'AbortError') setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `Error: ${err}` }]); }
    finally { setIsStreaming(false); abortRef.current = null; }
  }, [isStreaming, hasConfig, files, activeFile, statData, execTool, loadData]);

  const active = files.find(f => f.fileId === activeFile);
  const stats = (statData?.statistics as Record<string, unknown>[]) || [];
  const outliers = statData?.outlier_count as number || 0;

  return (
    <div className="dashboard">
      <header className="app-header">
        <h1>Excel Data Workbench</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasConfig ? <span className="badge green">Connected</span> : <span className="badge" style={{ background: '#fff5b1', color: '#9a6700' }}>未配置</span>}
          <button className="btn-icon" onClick={() => setShowSettings(!showSettings)}>⚙</button>
        </div>
      </header>
      {showSettings && <SettingsPanel onSaved={() => { setHasConfig(true); setShowSettings(false); }} onClose={() => setShowSettings(false)} />}
      <div className="db-body">
        <div className="main-area">
          <div className="upload-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}>
            📤 拖拽 Excel 文件，或 <label className="link">点击上传<input type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} hidden /></label>
          </div>
          {files.length > 0 && (
            <div className="file-tabs">
              {files.map(f => <button key={f.fileId} className={f.fileId === activeFile ? 'active' : ''} onClick={() => loadData(f.fileId)}>📄 {f.name}</button>)}
            </div>
          )}
          {active && <div className="actions"><button className="primary" onClick={() => execTool({ id:'', name:'run_clean', input:{} })}>🧹 清洗下载</button><button onClick={() => window.open(downloadUrl(active.fileId), '_blank')}>📥 下载</button></div>}
          {active && stats.length > 0 && (
            <div className="card">
              <div className="card-header"><h3>📊 {active.name}</h3><button onClick={() => loadData(activeFile!)}>🔄</button></div>
              <div className="card-body scroll" style={{ padding: 0 }}>
                <table className="data"><thead><tr><th>列</th><th>数量</th><th>均值</th><th>中位数</th><th>最小</th><th>最大</th><th>缺失%</th></tr></thead>
                  <tbody>{stats.map((s, i) => <tr key={i}><td>{String(s.metric)}</td><td>{String(s.count)}</td><td>{String(s.mean)}</td><td>{String(s.median)}</td><td>{String(s.min)}</td><td>{String(s.max)}</td><td className={Number(s.missing_pct) > 10 ? 'warn' : ''}>{String(s.missing_pct)}%</td></tr>)}</tbody></table>
              </div>
            </div>
          )}
          {outliers > 0 && <p className="text-warn">⚠ {outliers} 个异常值</p>}
          {files.length >= 2 && (
            <div className="card"><div className="card-header"><h3>🔍 对比</h3></div><div className="card-body">
              <div className="cmp-row"><select value={compareA} onChange={e => setCompareA(e.target.value)}><option value="">文件 A</option>{files.map(f => <option key={f.fileId} value={f.fileId}>{f.name}</option>)}</select><span>vs</span><select value={compareB} onChange={e => setCompareB(e.target.value)}><option value="">文件 B</option>{files.map(f => <option key={f.fileId} value={f.fileId}>{f.name}</option>)}</select><button className="btn primary" onClick={async () => { const cv = compareResult?.values as Record<string,unknown>|undefined; const r = await execTool({ id:'', name:'run_compare', input:{ file_id_a:compareA, file_id_b:compareB } }); }}>对比</button></div>
              {compareResult && <div style={{ background:'#f6f8fa',padding:10,borderRadius:6 }}>{JSON.stringify(compareResult.values)}</div>}
            </div></div>
          )}
        </div>
        <div className="resize-handle" onMouseDown={e => { e.preventDefault(); const sx = e.clientX; const sw = 380; const mv = (ev: MouseEvent) => { const nb = document.querySelector('.chat-sidebar') as HTMLElement; if (nb) nb.style.width = Math.max(280,Math.min(600,sw+sx-ev.clientX))+'px'; }; const up = () => { document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); }; document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up); }} />
        <div className="chat-sidebar">
          <div className="card"><div className="card-header"><h3>💬 AI 洞察</h3></div>
            <div className="chat-messages">
              {messages.length === 0 && <div className="empty">上传文件后提问<br/>Agent 自动调用工具分析<br/><br/><b>/profile /clean /compare /help</b></div>}
              {messages.map(m => <div key={m.id} className={`msg ${m.role}`}><div className="msg-label">{m.role==='user'?'You':m.role==='tool'?'':m.role==='system'?'':'AI'}</div><div dangerouslySetInnerHTML={{ __html: m.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/```(\w*)\n([\s\S]*?)```/g,'<pre>$2</pre>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>') }} /></div>)}
            </div>
            <div className="chat-bar">
              <input placeholder="输入问题或 / 命令..." onKeyDown={e => { if (e.key==='Enter'&&!isStreaming) { handleSend((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value=''; } }} disabled={isStreaming} />
              <button onClick={() => { const i = document.querySelector('.chat-bar input') as HTMLInputElement; if (i?.value) { handleSend(i.value); i.value=''; } }} disabled={isStreaming||!hasConfig}>发送</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
