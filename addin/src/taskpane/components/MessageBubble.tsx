/**
 * MessageBubble.tsx — Single chat message with optional "Write to Sheet" action.
 */

import React, { useCallback } from 'react';
import type { Message } from './App';
import ResultActions from './ResultActions';
import { estimateTokens } from '../../services/token-counter';

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props): JSX.Element {
  const { role, content, hasTable } = message;

  if (role === 'system') {
    return (
      <div style={{
        textAlign: 'center', fontSize: 11, color: '#999',
        padding: '6px 0',
      }}>
        {content}
      </div>
    );
  }

  const tokens = estimateTokens(content);

  return (
    <div className={`message ${role}`}>
      <div className="label">
        {role === 'user' ? 'You' : 'Claude'}
        {content && role === 'assistant' && (
          <span style={{ fontSize: 9, color: '#999', marginLeft: 8 }}>
            ~{tokens} tokens
          </span>
        )}
      </div>
      <div
        className="message-content"
        dangerouslySetInnerHTML={{
          __html: renderContent(content),
        }}
      />
      {role === 'assistant' && content && (
        <ResultActions content={content} hasTable={!!hasTable} />
      )}
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
