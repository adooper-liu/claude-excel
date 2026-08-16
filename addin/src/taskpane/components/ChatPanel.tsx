/**
 * ChatPanel.tsx — Scrollable chat message list.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Message } from './App';
import MessageBubble from './MessageBubble';
import { TALK_EXAMPLES, type SlashSkill } from '../../services/slash-skills';
import type { Pack } from '../../services/user-skills';

interface Props {
  messages: Message[];
  skills?: SlashSkill[];
  packs?: Pack[];
  onPickSkill?: (text: string) => void;
  isStreaming?: boolean;
  onInstallSample?: (id: string) => Promise<void>;
  onInstallPack?: (packId: string) => Promise<void>;
  sampleInstalled?: boolean;
}

export default function ChatPanel({
  messages,
  skills = [],
  packs = [],
  onPickSkill,
  isStreaming = false,
  onInstallSample,
  onInstallPack,
  sampleInstalled = false,
}: Props): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleErr, setSampleErr] = useState('');
  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [packErr, setPackErr] = useState('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const packGroups: Array<{ label: string; items: Pack[] }> = [];
  for (const p of packs) {
    const label = p.categoryLabel || p.category || '未分类';
    const g = packGroups.find((x) => x.label === label);
    if (g) g.items.push(p);
    else packGroups.push({ label, items: [p] });
  }

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
          {packGroups.length > 0 && (
            <div className="pack-groups">
              {packGroups.map((g) => (
                <div key={g.label} className="pack-group">
                  <div className="pack-group-label">{g.label}</div>
                  {g.items.map((p) => (
                    <div key={p.id} className="pack-card">
                      <div className="pack-card-title">{p.title}</div>
                      {p.description && <div className="pack-card-desc">{p.description}</div>}
                      <div className="pack-card-meta">
                        {p.skills.map((s) => '/' + s.slash).join(' · ')}
                        {p.installed ? ' · 已安装' : ''}
                      </div>
                      {!p.installed && onInstallPack && (
                        <button
                          type="button"
                          className="pack-install-btn"
                          disabled={packBusy === p.id}
                          onClick={() => {
                            setPackErr('');
                            setPackBusy(p.id);
                            void onInstallPack(p.id)
                              .catch((err) => {
                                setPackErr(err instanceof Error ? err.message : String(err));
                              })
                              .finally(() => setPackBusy(null));
                          }}
                        >
                          {packBusy === p.id ? '安装中…' : '安装场景包'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {packErr && <p className="empty-onboard-err">{packErr}</p>}
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
