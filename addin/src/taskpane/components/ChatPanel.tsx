/**
 * ChatPanel.tsx — Scrollable chat message list.
 */

import React, { useEffect, useRef } from 'react';
import type { Message } from './App';
import MessageBubble from './MessageBubble';
import type { SlashSkill } from '../../services/slash-skills';

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
    const starters = skills.filter((s) => s.id !== "skillify")
      .concat(skills.filter((s) => s.id === "skillify"));
    return (
      <div className="empty-state">
        <div className="empty-inner">
          <div className="fx-hint">fx</div>
          <h2>对着工作簿说话</h2>
          <p className="skill-start-label">从这些技能开始：</p>
          <div className="skill-start-list">
            {starters.map((s) => (
              <button
                key={s.id}
                type="button"
                className="skill-start-btn"
                title={s.title}
                onClick={() => onPickSkill?.("/" + s.slash)}
              >
                <span className="slash-cmd"><span className="slash-mark">/</span>{s.slash}</span>
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
