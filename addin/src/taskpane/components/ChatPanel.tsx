/**
 * ChatPanel.tsx — Scrollable chat message list.
 */

import React, { useEffect, useRef } from 'react';
import type { Message } from './App';
import MessageBubble from './MessageBubble';
import { TALK_EXAMPLES, type SlashSkill } from '../../services/slash-skills';

interface Props {
  messages: Message[];
  skills?: SlashSkill[];
  onPickSkill?: (text: string) => void;
  isStreaming?: boolean;
}

export default function ChatPanel({ messages, skills = [], onPickSkill, isStreaming = false }: Props): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-inner">
          <div className="fx-hint">fx</div>
          <h2>对着工作簿说话</h2>
          <p className="skill-start-label">直接说要干什么，不必先选命令。</p>
          <div className="skill-start-list">
            {TALK_EXAMPLES.map((ask) => (
              <button
                key={ask}
                type="button"
                className="skill-start-btn"
                onClick={() => onPickSkill?.(ask)}
              >
                {ask}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const lastAid = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <div className="chat-panel">
      {messages.map(msg => (
        <MessageBubble
          key={msg.id}
          message={msg}
          active={msg.id === lastAid && !isStreaming}
          onChoice={onPickSkill}
          skills={skills}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
