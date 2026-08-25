/**
 * ChatInput.tsx — Text input with send, stop, ⚡ templates, and / skills.
 */

import React, { useState, useRef, useCallback, KeyboardEvent, useMemo } from 'react';
import PromptMenu from './PromptMenu';
import FetchBar, { type FetchRows } from './FetchBar';
import KnowledgeBar from './KnowledgeBar';
import { filterSlashSkills, parseSlashCommand, slashQuery, type SlashSkill } from '../../services/slash-skills';
import { deleteUserSkill, installUserSkill, type InstalledSkill } from '../../services/user-skills';
import { operatorCatalogByGroup } from '../../services/operator-catalog';
import FinancePackQuickActions from './FinancePackQuickActions';

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
  const [installFileName, setInstallFileName] = useState('');
  const [installErr, setInstallErr] = useState('');
  const [installing, setInstalling] = useState(false);
  const [showFetch, setShowFetch] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [installPasteOpen, setInstallPasteOpen] = useState(false);
  const [showOperatorRef, setShowOperatorRef] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const skillFileRef = useRef<HTMLInputElement>(null);

  const query = slashQuery(text);
  const skills = query == null ? [] : filterSlashSkills(query, installed);
  const completeSlash = !!parseSlashCommand(text.trim(), installed);
  const wantInstall = query === "安装" || query === "install";
  const showSlash = !disabled && !isStreaming && query != null && !completeSlash;
  const operatorGroups = useMemo(function () {
    return operatorCatalogByGroup(false);
  }, []);

  const applySkill = useCallback((skill: SlashSkill) => {
    setText('/' + skill.slash);
    setActive(0);
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + 'px';
    }
  }, []);

  const handleInstall = useCallback(async (mdOverride?: string) => {
    const md = String(mdOverride ?? pasteMd).trim();
    if (!md || installing) return;
    setInstalling(true);
    setInstallErr('');
    try {
      const skill = await installUserSkill(md);
      const next = installed.filter((s) => s.id !== skill.id).concat([skill]);
      onInstalledChange?.(next);
      setPasteMd('');
      setInstallFileName('');
      setInstallPasteOpen(false);
      setText('/' + skill.slash);
    } catch (err) {
      setInstallErr(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }, [pasteMd, installing, installed, onInstalledChange]);

  const loadSkillMarkdown = useCallback((raw: string, fileName?: string) => {
    setPasteMd(raw);
    setInstallFileName(fileName || '');
    setInstallErr('');
  }, []);

  const readSkillFile = useCallback(
    (file: File) => {
      const name = file.name || '';
      const okExt = /\.(md|markdown|txt)$/i.test(name);
      const okType = !file.type || /text|markdown|octet-stream/i.test(file.type);
      if (!okExt && !okType) {
        setInstallErr('请选择 .md / .markdown / .txt 文件');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        if (!text.trim()) {
          setInstallErr('文件是空的');
          return;
        }
        loadSkillMarkdown(text, name);
        void handleInstall(text);
      };
      reader.onerror = () => setInstallErr('读取文件失败');
      reader.readAsText(file, 'UTF-8');
    },
    [handleInstall, loadSkillMarkdown]
  );

  const onSkillFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) readSkillFile(file);
      e.target.value = '';
    },
    [readSkillFile]
  );

  const onSkillDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files?.[0];
      if (file) readSkillFile(file);
    },
    [readSkillFile]
  );

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
      <FinancePackQuickActions
        skills={installed}
        disabled={disabled || isStreaming}
        onRun={(t) => {
          if (disabled || isStreaming) return;
          onSend(t);
        }}
      />
      {showFetch && onFetched && (
        <FetchBar
          disabled={disabled || isStreaming}
          onFetched={onFetched}
        />
      )}
      {showKnowledge && (
        <KnowledgeBar disabled={disabled || isStreaming} />
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
        <button
          type="button"
          className={`icon-btn${showKnowledge ? " on" : ""}`}
          disabled={disabled || isStreaming}
          onClick={() => setShowKnowledge((v) => !v)}
          title="本机知识库"
          aria-label="本机知识库"
        >知</button>
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
            <div className="flyout-head">
              <span>加速器</span>
              <span className="skill-flyout-hint">输入 / 筛选</span>
            </div>
            {skills.length > 0 && (
              <ul className="prompt-list skill-slash-list">
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
                      <span className="slash-cmd">
                        <span className="slash-mark">/</span>
                        {s.slash}
                      </span>
                      {s.installed && <span className="prompt-pick-tag">已安装</span>}
                    </button>
                    {s.installed && (
                      <button
                        type="button"
                        className="prompt-del"
                        title="卸载"
                        aria-label={"卸载 " + s.slash}
                        onClick={() => handleDeleteInstalled(s.id)}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(wantInstall || skills.length === 0) && skills.length === 0 && (
              <p className="flyout-empty">没有匹配的斜杠。可安装外部 SKILL.md。</p>
            )}
            <div
              className="skill-install"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={onSkillDrop}
            >
              <div className="skill-install-label">安装外部技能</div>
              <input
                ref={skillFileRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                className="skill-file-input"
                onChange={onSkillFilePick}
                aria-hidden
                tabIndex={-1}
              />
              <button
                type="button"
                className="skill-upload-zone"
                disabled={installing}
                onClick={() => skillFileRef.current?.click()}
              >
                <span className="skill-upload-icon">↑</span>
                <span className="skill-upload-title">{installing ? '正在安装…' : '上传 SKILL.md'}</span>
                <span className="skill-upload-sub">点击选择，或拖放 .md 到此处</span>
              </button>
              {installFileName && !installErr && (
                <p className="skill-install-file">已选：{installFileName}</p>
              )}
              <button
                type="button"
                className="skill-install-toggle"
                onClick={() => setInstallPasteOpen((v) => !v)}
              >
                {installPasteOpen ? '收起粘贴' : '或粘贴内容'}
              </button>
              {installPasteOpen && (
                <>
                  <textarea
                    value={pasteMd}
                    onChange={(e) => {
                      setPasteMd(e.target.value);
                      setInstallFileName('');
                      setInstallErr('');
                    }}
                    placeholder="---&#10;name: my-skill&#10;description: 简短说明&#10;slash: 我的技能&#10;---&#10;正文步骤…"
                    rows={5}
                    aria-label="粘贴 SKILL.md 内容"
                  />
                  <div className="skill-install-actions">
                    <button
                      type="button"
                      className="skill-install-primary"
                      onClick={() => void handleInstall()}
                      disabled={!pasteMd.trim() || installing}
                    >
                      安装
                    </button>
                  </div>
                </>
              )}
              {installErr && <p className="skill-install-err">{installErr}</p>}
              <p className="skill-install-note">需 YAML 头：name、description、slash；正文只编排现有 Office JS 算子。</p>
            </div>
            <div className="skill-operator-ref">
              <button
                type="button"
                className="skill-install-toggle"
                onClick={() => setShowOperatorRef((v) => !v)}
                aria-expanded={showOperatorRef}
              >
                {showOperatorRef ? "收起算子参考" : "算子参考（" + operatorGroups.reduce(function (n, g) { return n + g.items.length; }, 0) + "）"}
              </button>
              {showOperatorRef && (
                <div className="skill-operator-list" role="region" aria-label="算子参考">
                  {operatorGroups.map(function (g) {
                    return (
                      <div key={g.id} className="skill-operator-group">
                        <div className="skill-operator-group-label">{g.label}</div>
                        <ul className="skill-operator-items">
                          {g.items.map(function (item) {
                            return (
                              <li key={item.name}>
                                <code className="skill-operator-name">{item.name}</code>
                                <span className="skill-operator-hint">{item.hint}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
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
