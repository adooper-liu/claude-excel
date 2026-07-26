import React, { useState, useCallback } from 'react';
import { validateKey, saveConfig } from '../services/api';

interface Props { onSaved: () => void; onClose: () => void }

const PRESETS: Record<string, { name: string; baseUrl: string; model: string; smallFastModel: string }> = {
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-v4-pro[1m]', smallFastModel: 'deepseek-v4-flash' },
  qwen: { name: '阿里百炼 (通义千问)', baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic', model: 'qwen3-coder-plus', smallFastModel: 'qwen-flash' },
  glm: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-4-plus', smallFastModel: 'glm-4-flash' },
  minimax: { name: 'MiniMax', baseUrl: 'https://api.minimax.chat/anthropic', model: 'minimax-m1', smallFastModel: 'minimax-m1' },
  custom: { name: 'Custom', baseUrl: '', model: '', smallFastModel: '' },
};

export default function SettingsPanel({ onSaved, onClose }: Props): JSX.Element {
  const [preset, setPreset] = useState('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(PRESETS.deepseek.baseUrl);
  const [model, setModel] = useState(PRESETS.deepseek.model);
  const [smallFastModel, setSmallFastModel] = useState(PRESETS.deepseek.smallFastModel);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePreset = (key: string) => {
    setPreset(key);
    const p = PRESETS[key];
    if (p?.baseUrl) setBaseUrl(p.baseUrl);
    if (p?.model) setModel(p.model);
    if (p?.smallFastModel) setSmallFastModel(p.smallFastModel);
  };

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) { setStatus('请输入 API Key'); return; }
    setLoading(true); setStatus('保存中...');
    try {
      await saveConfig({ apiKey: apiKey.trim(), baseUrl, model, smallFastModel });
      setStatus('✓ 已连接'); onSaved();
    } catch { setStatus('保存失败'); }
    setLoading(false);
  }, [apiKey, baseUrl, model, smallFastModel, onSaved]);

  return (
    <div className="settings-panel">
      <div className="settings-header"><h3>API 配置</h3><button onClick={onClose}>✕</button></div>

      <label>供应商</label>
      <select value={preset} onChange={e => handlePreset(e.target.value)}>
        {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
      </select>

      <label>API Key</label>
      <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />

      <label>Base URL</label>
      <input type="text" value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setPreset('custom'); }} />

      <label>Model</label>
      <input type="text" value={model} onChange={e => { setModel(e.target.value); setPreset('custom'); }} />

      <div className="settings-row">
        <button onClick={handleSave} disabled={loading}>{loading ? '验证...' : '保存并连接'}</button>
        <span className={`status ${status.includes('✓') ? 'green' : 'red'}`}>{status}</span>
      </div>
    </div>
  );
}
