/**
 * ChatPanel.tsx — Scrollable chat message list.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Message } from './App';
import MessageBubble from './MessageBubble';
import { TALK_EXAMPLES, type SlashSkill } from '../../services/slash-skills';

interface Props {
  messages: Message[];
  skills?: SlashSkill[];
  onPickSkill?: (text: string) => void;
  isStreaming?: boolean;
  onInstallSample?: (id: string) => Promise<void>;
  sampleInstalled?: boolean;
}

export default function ChatPanel({
  messages,
  skills = [],
  onPickSkill,
  isStreaming = false,
  onInstallSample,
  sampleInstalled = false,
}: Props): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleErr, setSampleErr] = useState('');

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
          <p className="empty-onboard-hint">
            跨境示例见 samples，可上传知识库或 /skill-creator 安装。
          </p>
          {onInstallSample && !sampleInstalled && (
            <button
              type="button"
              className="empty-sample-install"
              disabled={sampleBusy}
              onClick={() => {
                setSampleErr('');
                setSampleBusy(true);
                void onInstallSample('amazon-research')
                  .catch((err) => {
                    setSampleErr(err instanceof Error ? err.message : String(err));
                  })
                  .finally(() => setSampleBusy(false));
              }}
            >
              {sampleBusy ? '安装中…' : '安装 Amazon 选品示例技能'}
            </button>
          )}
          {sampleInstalled && (
            <p className="empty-onboard-done">已安装 /亚马逊选品 — 可直接试跑或继续 /skill-creator 改步骤。</p>
          )}
          {sampleErr && <p className="empty-onboard-err">{sampleErr}</p>}
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
