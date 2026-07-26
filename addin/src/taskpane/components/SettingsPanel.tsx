/**
 * SettingsPanel.tsx — Multi-provider API configuration.
 *
 * Supports any Anthropic-compatible API: DeepSeek, Qwen (Alibaba), GLM (Zhipu),
 * MiniMax, or custom endpoint. Provider presets auto-fill Base URL + Model.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { ApiMode } from '../../services/claude';
import { setMode, setBaseUrl, setModel, setSmallFastModel, setProviderConfig } from '../../services/claude';
import { setupDirectMode, setupProxyMode, AuthStatus } from '../../services/auth';

interface Props {
  onReady: () => void;
}

interface ProviderPreset {
  name: string;
  baseUrl: string;
  model: string;
  smallFastModel: string;
}

const PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-pro[1m]',
    smallFastModel: 'deepseek-v4-flash',
  },
  qwen: {
    name: '阿里百炼 (通义千问)',
    baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    model: 'qwen3-coder-plus',
    smallFastModel: 'qwen-flash',
  },
  glm: {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-4-plus',
    smallFastModel: 'glm-4-flash',
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/anthropic',
    model: 'minimax-m1',
    smallFastModel: 'minimax-m1',
  },
  custom: {
    name: 'Custom (手动输入)',
    baseUrl: '',
    model: '',
    smallFastModel: '',
  },
};

export default function SettingsPanel({ onReady }: Props): JSX.Element {
  const [mode, setModeState] = useState<ApiMode>('proxy');
  const [apiKey, setApiKey] = useState('');
  const [proxyUrl, setProxyUrl] = useState('https://localhost:8765');
  const [preset, setPreset] = useState('deepseek');
  const [baseUrl, setBaseUrlState] = useState(PRESETS.deepseek.baseUrl);
  const [model, setModelState] = useState(PRESETS.deepseek.model);
  const [smallFastModel, setSmallFastModelState] = useState(PRESETS.deepseek.smallFastModel);
  const [status, setStatus] = useState<{ type: AuthStatus; msg?: string }>({ type: 'unconfigured' });
  const [loading, setLoading] = useState(false);

  // When preset changes, update fields
  const handlePresetChange = useCallback((key: string) => {
    setPreset(key);
    const p = PRESETS[key];
    if (p) {
      if (p.baseUrl) setBaseUrlState(p.baseUrl);
      if (p.model) setModelState(p.model);
      if (p.smallFastModel) setSmallFastModelState(p.smallFastModel);
    }
  }, []);

  const handleConnect = useCallback(async () => {
    setLoading(true);
    setStatus({ type: 'validating' });

    try {
      // Save provider config globally
      setProviderConfig({ baseUrl, model, smallFastModel });
      setMode(mode);

      let result: { status: AuthStatus; error?: string };

      if (mode === 'direct') {
        result = await setupDirectMode(apiKey);
      } else {
        result = await setupProxyMode(proxyUrl, apiKey);
      }

      if (result.status === 'ready') {
        setStatus({ type: 'ready' });
        onReady();
      } else {
        setStatus({ type: 'error', msg: result.error || 'Configuration failed.' });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  }, [mode, apiKey, proxyUrl, baseUrl, model, smallFastModel, onReady]);

  return (
    <div className="settings-panel">
      <h3>API Configuration</h3>

      <label>Provider</label>
      <select value={preset} onChange={e => handlePresetChange(e.target.value)}>
        {Object.entries(PRESETS).map(([key, p]) => (
          <option key={key} value={key}>{p.name}</option>
        ))}
      </select>

      <label>API Key</label>
      <input
        type="password"
        value={apiKey}
        onChange={e => setApiKey(e.target.value)}
        placeholder="sk-..."
      />

      <label>Base URL (Anthropic-compatible)</label>
      <input
        type="text"
        value={baseUrl}
        onChange={e => { setBaseUrlState(e.target.value); setPreset('custom'); }}
        placeholder="https://api.deepseek.com/anthropic"
      />

      <label>Model</label>
      <input
        type="text"
        value={model}
        onChange={e => { setModelState(e.target.value); setPreset('custom'); }}
        placeholder="deepseek-v4-pro[1m]"
      />

      <label>Small / Fast Model</label>
      <input
        type="text"
        value={smallFastModel}
        onChange={e => { setSmallFastModelState(e.target.value); setPreset('custom'); }}
        placeholder="deepseek-v4-flash"
      />

      <label>Connection Mode</label>
      <select value={mode} onChange={e => setModeState(e.target.value as ApiMode)}>
        <option value="proxy">Proxy (Backend Server)</option>
        <option value="direct">Direct (BYOK)</option>
      </select>

      {mode === 'proxy' && (
        <>
          <label>Backend Server URL</label>
          <input
            type="text"
            value={proxyUrl}
            onChange={e => setProxyUrl(e.target.value)}
            placeholder="https://localhost:8765"
          />
          <div style={{ fontSize: 10, color: '#999', marginBottom: 8 }}>
            Config is sent to the backend and stored server-side.
            The backend proxies all AI API calls — your key never leaves the server.
          </div>
        </>
      )}

      {mode === 'direct' && (
        <div style={{ fontSize: 10, color: '#999', marginBottom: 8 }}>
          API calls go directly from your browser to the provider endpoint.
          Key stays in memory only.
        </div>
      )}

      <div className="settings-row">
        <button onClick={handleConnect} disabled={loading}>
          {loading ? 'Connecting...' : 'Connect'}
        </button>
        {status.type === 'validating' && <span style={{ fontSize: 11, color: '#999' }}>Validating...</span>}
        {status.type === 'error' && <span style={{ fontSize: 11, color: '#dc2626' }}>{status.msg}</span>}
        {status.type === 'ready' && <span style={{ fontSize: 11, color: '#16a34a' }}>✓ Connected</span>}
      </div>
    </div>
  );
}
