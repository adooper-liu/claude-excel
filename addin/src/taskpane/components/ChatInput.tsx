/**
 * ChatInput.tsx — Text input with send, stop, ⚡ templates, and / skills.
 */

import React, { useState, useRef, useCallback, KeyboardEvent } from 'react';
import PromptMenu from './PromptMenu';
import FetchBar, { type FetchRows } from './FetchBar';
import { filterSlashSkills, parseSlashCommand, slashQuery, type SlashSkill } from '../../services/slash-skills';
import { deleteUserSkill, installUserSkill, type InstalledSkill } from '../../services/user-skills';

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled: boolean;
  installed?: InstalledSkill[];
  onInstalledChange?: (skills: InstalledSkill[]) => void;
  onFetched?: (rows: FetchRows, sheetName: string, opts?: { append?: boolean }) => Promise<string | void>;
}

export default function ChatInput({
  onSend, onStop, isStreaming, disabled,   installed = [], onInstalledChange, onFetched,
}: Props): JSX.Element {
  const [text, setText] = useState('');
  const [showPrompts, setShowPrompts] = useState(false);
  const [active, setActive] = useState(0);
  const [pasteMd, setPasteMd] = useState('');
  const [installErr, setInstallErr] = useState('');
  const [installing, setInstalling] = useState(false);
  const [showFetch, setShowFetch] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const query = slashQuery(text);
  const skills = query == null ? [] : filterSlashSkills(query, installed);
  const completeSlash = !!parseSlashCommand(text.trim(), installed);
  const wantInstall = query === "安装" || query === "install";
  const showSlash = !disabled && !isStreaming && query != null && !completeSlash && (skills.length > 0 || wantInstall);

  const applySkill = useCallback((skill: SlashSkill) => {
    setText('/' + skill.slash);
    setActive(0);
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + 'px';
    }
  }, []);

  const handleInstall = useCallback(async () => {
    const md = pasteMd.trim();
    if (!md || installing) return;
    setInstalling(true);
    setInstallErr('');
    try {
      const skill = await installUserSkill(md);
      const next = installed.filter((s) => s.id !== skill.id).concat([skill]);
      onInstalledChange?.(next);
      setPasteMd('');
      setText('/' + skill.slash);
    } catch (err) {
      setInstallErr(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }, [pasteMd, installing, installed, onInstalledChange]);

  const handleDeleteInstalled = useCallback(async (id: string) => {
    try {
      await deleteUserSkill(id);
      onInstalledChange?.(installed.filter((s) => s.id !== id));
    } catch (err) {
      setInstallErr(err instanceof Error ? err.message : String(err));
    }
  }, [installed, onInstalledChange]);

  const handleSend = useCallback(() => {
    const raw = text.trim();
    if (!raw || isStreaming) return;
    if (raw.startsWith('/') && !parseSlashCommand(raw, installed) && slashQuery(raw) != null) return;
    onSend(raw);
    setText('');
    setShowPrompts(false);
    setActive(0);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, isStreaming, onSend, installed]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (showSlash) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (skills.length) setActive((i) => (i + 1) % skills.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (skills.length) setActive((i) => (i - 1 + skills.length) % skills.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (skills[active] || skills[0]) applySkill(skills[active] || skills[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setText('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [showSlash, skills, active, applySkill, handleSend]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 100) + 'px';
    }
  }, []);

  return (
    <div className="composer">
      {showFetch && onFetched && (
        <FetchBar
          disabled={disabled || isStreaming}
          onFetched={onFetched}
        />
      )}
    <div className="chat-input-area">
      <div className="chat-input-tools">
        <button
          type="button"
          className="icon-btn"
          disabled={disabled || isStreaming}
          onClick={() => setShowPrompts((v) => !v)}
          title="预置指令"
          aria-label="预置指令"
        >⚡</button>
        <button
          type="button"
          className={`icon-btn${showFetch ? " on" : ""}`}
          disabled={disabled || isStreaming}
          onClick={() => setShowFetch((v) => !v)}
          title="从网址取数"
          aria-label="从网址取数"
        >网</button>
        {showPrompts && (
          <PromptMenu
            draft={text}
            onPick={(prompt) => {
              setText(prompt);
              setShowPrompts(false);
              if (textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + 'px';
              }
            }}
            onClose={() => setShowPrompts(false)}
          />
        )}
        {showSlash && (
          <div className="flyout prompt-flyout skill-flyout" role="listbox" aria-label="加速器">
            <div className="flyout-head"><span>加速器</span></div>
            {skills.length > 0 && (
              <ul className="prompt-list">
                {skills.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`prompt-pick${i === active ? ' active' : ''}`}
                      title={s.title}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => applySkill(s)}
                    >
                      <span className="skill-pick-title">{s.title}</span>
                      <span className="slash-cmd"><span className="slash-mark">/</span>{s.slash}</span>
                    </button>
                    {s.installed && (
                      <button
                        type="button"
                        className="prompt-del"
                        title="卸载"
                        aria-label={"卸载 " + s.slash}
                        onClick={() => handleDeleteInstalled(s.id)}
                      >✕</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="skill-install">
              <textarea
                value={pasteMd}
                onChange={(e) => { setPasteMd(e.target.value); setInstallErr(''); }}
                placeholder="粘贴 SKILL.md 安装外部技能"
                rows={4}
              />
              <button type="button" onClick={handleInstall} disabled={!pasteMd.trim() || installing}>
                安装
              </button>
              {installErr && <p className="skill-install-err">{installErr}</p>}
            </div>
          </div>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => { setText(e.target.value); setActive(0); }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? '请先在设置里配置接口' : '对着工作簿说话…'}
        disabled={disabled}
        rows={1}
      />
      {isStreaming ? (
        <button className="stop" onClick={onStop}>停止</button>
      ) : (
        <button onClick={handleSend} disabled={disabled || !text.trim()}>
          发送
        </button>
      )}
    </div>
    </div>
  );
}
