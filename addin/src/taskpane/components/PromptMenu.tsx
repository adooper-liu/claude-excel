import React, { useCallback, useEffect, useState } from 'react';
import {
  BUILTIN_PROMPTS,
  loadCustomTemplates,
  makeCustomTemplateId,
  mergeTemplates,
  saveCustomTemplates,
  type PromptTemplate,
} from '../../services/prompt-templates';

interface Props {
  draft: string;
  onPick: (prompt: string) => void;
  onClose: () => void;
}

export default function PromptMenu({ draft, onPick, onClose }: Props): JSX.Element {
  const [custom, setCustom] = useState<PromptTemplate[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [saveErr, setSaveErr] = useState('');

  const reload = useCallback(async () => {
    setCustom(await loadCustomTemplates());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const items = mergeTemplates(BUILTIN_PROMPTS, custom);

  const persist = async (nextCustom: PromptTemplate[]) => {
    setSaveErr('');
    const saved = await saveCustomTemplates(nextCustom);
    setCustom(saved);
  };

  const handleAdd = async () => {
    const title = newTitle.trim() || '我的指令';
    const prompt = newPrompt.trim();
    if (!prompt) {
      setSaveErr('请填写指令正文。');
      return;
    }
    await persist(
      custom.concat([
        {
          id: makeCustomTemplateId(),
          title,
          prompt,
          custom: true,
        },
      ])
    );
    setNewTitle('');
    setNewPrompt('');
  };

  const handleFillFromDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setNewPrompt(text);
    if (!newTitle.trim()) setNewTitle(text.slice(0, 16));
    setSaveErr('');
  };

  const handleDelete = async (id: string) => {
    await persist(custom.filter((p) => p.id !== id));
  };

  return (
    <div className="flyout prompt-flyout" role="dialog" aria-label="预置指令">
      <div className="flyout-head">
        <span>预置指令</span>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">
          ✕
        </button>
      </div>
      <ul className="prompt-list">
        {items.map((p) => (
          <li key={p.id}>
            <button type="button" className="prompt-pick" onClick={() => onPick(p.prompt)}>
              <span className="prompt-pick-title">{p.title}</span>
              {p.custom && <span className="prompt-pick-tag">自定义</span>}
            </button>
            {p.custom && (
              <button
                type="button"
                className="prompt-del"
                onClick={() => handleDelete(p.id)}
                title="删除"
                aria-label={'删除 ' + p.title}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="prompt-add">
        <div className="prompt-add-label">添加指令</div>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="名称，例如：Amazon 规整列"
          aria-label="指令名称"
        />
        <textarea
          value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          placeholder="指令正文，可多行"
          rows={3}
          aria-label="指令正文"
        />
        <div className="prompt-add-actions">
          <button type="button" className="prompt-add-secondary" onClick={handleFillFromDraft} disabled={!draft.trim()}>
            用当前输入
          </button>
          <button type="button" className="prompt-add-primary" onClick={handleAdd} disabled={!newPrompt.trim()}>
            添加
          </button>
        </div>
        {saveErr && <p className="prompt-add-err">{saveErr}</p>}
      </div>
    </div>
  );
}
