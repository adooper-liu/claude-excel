/**
 * ChatPanel.tsx — Scrollable chat message list.
 */

import React, { useEffect, useRef } from 'react';
import type { Message } from './App';
import MessageBubble from './MessageBubble';

interface Props {
  messages: Message[];
}

export default function ChatPanel({ messages }: Props): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon">📊</div>
        <h2>Ask Claude about your data</h2>
        <p>
          Select cells in Excel, then ask a question.
          Try "Analyze this data" or "What trends do you see?"
        </p>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
