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
  onInstallPack?: (packId: string) => Promise<void>;
  onUninstallPack?: (packId: string) => Promise<void>;
}

export default function ChatPanel({
  messages,
  skills = [],
  packs = [],
  onPickSkill,
  isStreaming = false,
  onInstallPack,
  onUninstallPack,
}: Props): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);
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

  const anyPackInstalled = packGroups.some((g) => g.items.some((p) => p.installed));

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
          {anyPackInstalled && (
            <p className="empty-onboard-done">
              场景包已安装 — 可用斜杠试跑；附录知识请用知栏上传 pack 内 knowledge 文件。
            </p>
          )}
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
                      {p.installed && onUninstallPack && (
                        <button
                          type="button"
                          className="pack-install-btn"
                          disabled={packBusy === p.id}
                          onClick={() => {
                            setPackErr('');
                            setPackBusy(p.id);
                            void onUninstallPack(p.id)
                              .catch((err) => {
                                setPackErr(err instanceof Error ? err.message : String(err));
                              })
                              .finally(() => setPackBusy(null));
                          }}
                        >
                          {packBusy === p.id ? '卸载中…' : '卸载'}
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
