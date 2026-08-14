/**
 * MessageBubble.tsx — Single chat message with optional "Write to Sheet" action.
 */

import React, { useState } from 'react';
import type { Message, ToolStep } from './App';
import ResultActions from './ResultActions';
import { extractMarkdownTable, trimMarkdownTable } from '../../services/markdown-table';
import { buildGenerateCommand, SKIP_SAMPLE_COMMAND, type SampleKit } from '../../excel/intent-guard';
import { slashDisplay, type SlashSkill } from '../../services/slash-skills';

interface Props {
  message: Message;
  active?: boolean;
  onChoice?: (text: string) => void;
  skills?: SlashSkill[];
}

export default function MessageBubble({ message, active = false, onChoice, skills = [] }: Props): JSX.Element | null {
  const { role, content, hasTable, steps, samplePrompt } = message;
  const slash = role === 'user' ? slashDisplay(content, skills) : null;

  if (role === 'assistant' && !content) return null;

  if (role === 'system') {
    return (
      <div className="message system">
        {content}
      </div>
    );
  }

  if (role === 'tool' && steps && steps.length > 0) {
    return (
      <div className="message tool">
        <div className="label">步骤</div>
        {steps.map((step, i) => (
          <ToolStepView key={i} step={step} />
        ))}
      </div>
    );
  }

  return (
    <div className={`message ${role}${slash ? ' skill' : ''}`}>
      <div className="label">
        {role === 'user' ? '你' : role === 'tool' ? '步骤' : '回复'}
      </div>
      {slash ? (
        <div className="message-content">
          <span className="slash-chip" title={slash.title || undefined}>
            <span className="slash-mark">/</span>{slash.token}
          </span>
          {slash.extra ? <span className="slash-extra">{slash.extra}</span> : null}
        </div>
      ) : (
        <div
          className="message-content"
          dangerouslySetInnerHTML={{
            __html: renderContent(content),
          }}
        />
      )}
      {role === 'assistant' && samplePrompt && active && onChoice && (
        <SampleConfirm kits={samplePrompt.kits} onChoice={onChoice} />
      )}
      {role === 'assistant' && content && !samplePrompt && (
        <ResultActions content={content} hasTable={!!hasTable} />
      )}
    </div>
  );
}

function SampleConfirm({ kits, onChoice }: { kits: SampleKit[]; onChoice: (text: string) => void }): JSX.Element {
  const [picked, setPicked] = useState<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};
    kits.forEach((k) => { next[k.id] = true; });
    return next;
  });
  const selected = kits.filter((k) => picked[k.id]).map((k) => k.id);
  return (
    <div className="sample-prompt">
      {kits.map((kit) => (
        <label key={kit.id} className="sample-kit">
          <input
            type="checkbox"
            checked={!!picked[kit.id]}
            onChange={() => setPicked((prev) => ({ ...prev, [kit.id]: !prev[kit.id] }))}
          />
          <span>{kit.label}</span>
        </label>
      ))}
      <div className="sample-actions">
        <button
          type="button"
          className="sample-btn primary"
          disabled={selected.length === 0}
          onClick={() => onChoice(buildGenerateCommand(selected))}
        >
          确认生成
        </button>
        <button
          type="button"
          className="sample-btn ghost"
          onClick={() => onChoice(SKIP_SAMPLE_COMMAND)}
        >
          不用
        </button>
      </div>
    </div>
  );
}

/**
 * Simple Markdown-to-HTML rendering.
 * Handles: headings, bold, code, tables, lists, paragraphs.
 */
function renderContent(text: string): string {
  if (!text) return '';

  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Headings
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Tables (match markdown tables)
    .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_match, header, body) => {
      const headers = header.split('|').map((h: string) => h.trim()).filter(Boolean);
      const rows = body.split('\n').filter((r: string) => r.trim());
      let tableHtml = '<table><thead><tr>';
      for (const h of headers) {
        tableHtml += `<th>${h}</th>`;
      }
      tableHtml += '</tr></thead><tbody>';
      for (const row of rows) {
        const cells = row.split('|').map((c: string) => c.trim()).filter(Boolean);
        tableHtml += '<tr>';
        for (const c of cells) {
          tableHtml += `<td>${c}</td>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      return tableHtml;
    })
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')
    // Single newline → <br>
    .replace(/\n/g, '<br>');

  return `<p>${html}</p>`;
}

function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function ToolStepView({ step }: { step: ToolStep }): JSX.Element {
  const bits = ['op', 'sheetName', 'tableName', 'leftTable', 'rightTable', 'key', 'groupBy', 'outputSheet']
    .map((k) => step.input[k])
    .filter((v) => v != null && String(v) !== '')
    .map(String);
  const title = bits.length ? `${step.name} · ${bits.join(' · ')}` : step.name;
  const pending = step.result == null;
  const table = step.result ? extractMarkdownTable(step.result) : null;
  return (
    <details className="tool-step">
      <summary>
        <span className="tool-step-name">{title}</span>
        {step.ms != null && <span className="tool-step-ms">{step.ms}ms</span>}
        {pending && <span className="tool-step-ms">…</span>}
      </summary>
      {table && (
        <div
          className="tool-step-preview"
          dangerouslySetInnerHTML={{ __html: renderContent(trimMarkdownTable(table)) }}
        />
      )}
      <pre className="tool-step-json">{pretty(step.input)}</pre>
      {step.result != null && (
        <pre className={`tool-step-json${/^Error:/.test(step.result) ? ' err' : ''}`}>{pretty(step.result)}</pre>
      )}
    </details>
  );
}
