import React, { useCallback, useEffect, useState } from 'react';
import { BUILTIN_PROMPTS, mergeTemplates, type PromptTemplate } from '../../services/prompt-templates';

const API = 'https://localhost:8765/api/templates';

interface Props {
  draft: string;
  onPick: (prompt: string) => void;
  onClose: () => void;
}

export default function PromptMenu({ draft, onPick, onClose }: Props): JSX.Element {
  const [custom, setCustom] = useState<PromptTemplate[]>([]);
  const [title, setTitle] = useState('');

  const reload = useCallback(async () => {
    try {
      const r = await fetch(API);
      if (!r.ok) return;
      const data = await r.json();
      setCustom(Array.isArray(data.templates) ? data.templates : []);
    } catch {
      /* backend down: builtins still work */
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const items = mergeTemplates(BUILTIN_PROMPTS, custom);

  const persist = async (nextCustom: PromptTemplate[]) => {
    const payload = nextCustom.map(({ id, title, prompt }) => ({ id, title, prompt }));
    try {
      const r = await fetch(API, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templates: payload }),
      });
      if (r.ok) {
        const data = await r.json();
        setCustom(Array.isArray(data.templates) ? data.templates : payload);
      } else {
        setCustom(payload);
      }
    } catch {
      setCustom(payload);
    }
  };

  const handleSave = async () => {
    const t = title.trim() || draft.trim().slice(0, 12) || '我的模板';
    const prompt = draft.trim();
    if (!prompt) return;
    const id = 'u_' + Date.now().toString(36);
    await persist(custom.concat([{ id, title: t, prompt, custom: true }]));
    setTitle('');
  };

  const handleDelete = async (id: string) => {
    await persist(custom.filter((p) => p.id !== id));
  };

  return (
    <div className="flyout prompt-flyout" role="dialog" aria-label="预置指令">
      <div className="flyout-head">
        <span>预置指令</span>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">✕</button>
      </div>
      <ul className="prompt-list">
        {items.map((p) => (
          <li key={p.id}>
            <button type="button" className="prompt-pick" onClick={() => onPick(p.prompt)}>{p.title}</button>
            {p.custom && (
              <button type="button" className="prompt-del" onClick={() => handleDelete(p.id)} title="删除">✕</button>
            )}
          </li>
        ))}
      </ul>
      <div className="prompt-save">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="名称（保存当前输入）"
        />
        <button type="button" onClick={handleSave} disabled={!draft.trim()}>保存</button>
      </div>
    </div>
  );
}
