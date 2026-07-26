import React, { useEffect, useRef } from 'react';
import type { Message } from '../App';

interface Props { messages: Message[] }

export default function ChatPanel({ messages }: Props): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  if (messages.length === 0) {
    return <div className="empty-state"><div className="icon">📊</div><h2>上传 Excel 开始分析</h2><p>拖拽或点击上传一个 .xlsx 文件，然后提问。</p></div>;
  }

  return (
    <div className="chat-panel">
      {messages.map(msg => (
        <div key={msg.id} className={`message ${msg.role}`}>
          <div className="label">{msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'AI' : ''}</div>
          <div className="content" dangerouslySetInnerHTML={{ __html: render(msg.content) }} />
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function render(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_m: string, hdr: string, body: string) => {
      const h = hdr.split('|').map((c: string) => c.trim()).filter(Boolean);
      const rows = body.split('\n').filter((r: string) => r.trim());
      let tbl = '<table><thead><tr>';
      h.forEach(c => { tbl += `<th>${c}</th>`; });
      tbl += '</tr></thead><tbody>';
      rows.forEach(r => {
        tbl += '<tr>';
        r.split('|').map((c: string) => c.trim()).filter(Boolean).forEach(c => { tbl += `<td>${c}</td>`; });
        tbl += '</tr>';
      });
      return tbl + '</tbody></table>';
    })
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>') + '</p>';
}
