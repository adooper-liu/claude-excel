/**
 * SettingsPanel.tsx — Multi-provider API configuration.
 *
 * Supports any Anthropic-compatible API: DeepSeek, Qwen (Alibaba), GLM (Zhipu),
 * MiniMax, or custom endpoint. 模型名不从代码预设——填 key 后从云端获取选择。
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { ApiMode } from '../../services/claude';
import { setMode, setProviderConfig } from '../../services/claude';
import { setupDirectMode, setupProxyMode, switchProvider, AuthStatus } from '../../services/auth';
import { API_BASE } from '../../services/api-config';
import BackupSection from './BackupSection';

interface Props {
  onReady: () => void;
}

interface ProviderPreset {
  name: string;
  baseUrl: string;
}

const PRESETS: Record<string, ProviderPreset> = {
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic' },
  qwen: { name: '阿里百炼 (通义千问)', baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic' },
  glm: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/anthropic' },
  minimax: { name: 'MiniMax', baseUrl: 'https://api.minimax.chat/anthropic' },
  custom: { name: 'Custom (手动输入)', baseUrl: '' },
};

export default function SettingsPanel({ onReady }: Props): JSX.Element {
  const [mode, setModeState] = useState<ApiMode>('proxy');
  const [apiKey, setApiKey] = useState('');
  const [proxyUrl, setProxyUrl] = useState(API_BASE);
  const [preset, setPreset] = useState('deepseek');
  const [baseUrl, setBaseUrlState] = useState(PRESETS.deepseek.baseUrl);
  const [model, setModelState] = useState('');
  const [smallFastModel, setSmallFastModelState] = useState('');
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [status, setStatus] = useState<{ type: AuthStatus; msg?: string }>({ type: 'unconfigured' });
  const [loading, setLoading] = useState(false);
  const [configuredProviders, setConfiguredProviders] = useState<Record<string, { hasKey: boolean; baseUrl: string; model: string }>>({});
  const [activeProvider, setActiveProvider] = useState('deepseek');

  // 切换 preset 只填 baseUrl，模型清空待重新获取
  const handlePresetChange = useCallback((key: string) => {
    setPreset(key);
    const p = PRESETS[key];
    if (p && p.baseUrl) setBaseUrlState(p.baseUrl);
    setModelState('');
    setSmallFastModelState('');
    setModels([]);
  }, []);

  // 拉取后端已配置的 provider 状态（不含 key），用于切换展示
  const loadConfiguredProviders = useCallback(async () => {
    try {
      const r = await fetch(`${proxyUrl}/api/config`);
      if (r.ok) {
        const c = (await r.json()) as {
          providers?: Record<string, { hasKey: boolean; baseUrl: string; model: string }>;
          activeProvider?: string;
        };
        if (c.providers) setConfiguredProviders(c.providers);
        if (c.activeProvider) setActiveProvider(c.activeProvider);
      }
    } catch {
      /* backend down */
    }
  }, [proxyUrl]);

  useEffect(() => {
    void loadConfiguredProviders();
  }, [loadConfiguredProviders]);

  // 用 key 从云端拉取该 provider 的模型列表
  const handleFetchModels = useCallback(async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setStatus({ type: 'error', msg: '请先填 baseUrl 和 API Key' });
      return;
    }
    setLoadingModels(true);
    try {
      const r = await fetch(`${proxyUrl}/api/models/list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey }),
      });
      if (!r.ok) {
        const err = await r.text();
        setStatus({ type: 'error', msg: `获取模型失败：${r.status} ${err}` });
        return;
      }
      const data = (await r.json()) as { models?: Array<{ id: string; name: string }> };
      setModels(data.models || []);
      if (!data.models?.length) {
        setStatus({ type: 'error', msg: '该 provider 未返回模型列表，请确认 key 与 baseUrl' });
      }
    } catch {
      setStatus({ type: 'error', msg: '获取模型列表失败：无法连接后端' });
    } finally {
      setLoadingModels(false);
    }
  }, [baseUrl, apiKey, proxyUrl]);

  const handleConnect = useCallback(async () => {
    if (!model.trim()) {
      setStatus({ type: 'error', msg: '请先获取模型列表并选择主模型' });
      return;
    }
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
        result = await setupProxyMode(proxyUrl, apiKey, preset);
      }

      if (result.status === 'ready') {
        setStatus({ type: 'ready' });
        await loadConfiguredProviders();
        onReady();
      } else {
        setStatus({ type: 'error', msg: result.error || 'Configuration failed.' });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  }, [mode, apiKey, proxyUrl, baseUrl, model, smallFastModel, preset, loadConfiguredProviders, onReady]);

  const handleSwitchProvider = useCallback(
    async (pid: string) => {
      setLoading(true);
      setStatus({ type: 'validating' });
      const res = await switchProvider(proxyUrl, pid);
      setLoading(false);
      if (res.status === 'ready') {
        if (res.baseUrl) setBaseUrlState(res.baseUrl);
        if (res.model) setModelState(res.model);
        if (res.smallFastModel) setSmallFastModelState(res.smallFastModel);
        setProviderConfig({
          baseUrl: res.baseUrl || '',
          model: res.model || '',
          smallFastModel: res.smallFastModel || '',
        });
        if (PRESETS[pid]) setPreset(pid);
        setActiveProvider(pid);
        setStatus({ type: 'ready' });
      } else {
        setStatus({ type: 'error', msg: res.error || '切换失败' });
      }
    },
    [proxyUrl]
  );

  return (
    <div className="settings-panel">
      <h3>API Configuration</h3>

      <label>Provider</label>
      <select value={preset} onChange={(e) => handlePresetChange(e.target.value)}>
        {Object.entries(PRESETS).map(([key, p]) => (
          <option key={key} value={key}>
            {p.name}
          </option>
        ))}
      </select>

      <label>API Key</label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="贴入该 provider 的 API key"
      />

      <label>Base URL (Anthropic-compatible)</label>
      <input
        type="text"
        value={baseUrl}
        onChange={(e) => {
          setBaseUrlState(e.target.value);
          setPreset('custom');
        }}
        placeholder="https://api.deepseek.com/anthropic"
      />

      <label>Model</label>
      <div className="settings-model-row">
        <select value={model} onChange={(e) => setModelState(e.target.value)}>
          <option value="">— 先获取模型列表 —</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button onClick={handleFetchModels} disabled={loadingModels || !apiKey.trim()}>
          {loadingModels ? '获取中...' : '获取模型列表'}
        </button>
      </div>

      <label>Small / Fast Model</label>
      <select value={smallFastModel} onChange={(e) => setSmallFastModelState(e.target.value)}>
        <option value="">— 不指定 —</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      <label>Connection Mode</label>
      <select value={mode} onChange={(e) => setModeState(e.target.value as ApiMode)}>
        <option value="proxy">Proxy (Backend Server)</option>
        <option value="direct">Direct (BYOK)</option>
      </select>

      {mode === 'proxy' && (
        <>
          <label>Backend Server URL</label>
          <input
            type="text"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder={API_BASE}
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
        {status.type === 'validating' && <span style={{ fontSize: 11, color: '#999' }}> Validating...</span>}
        {status.type === 'error' && <span style={{ fontSize: 11, color: '#dc2626' }}> {status.msg} </span>}
        {status.type === 'ready' && <span style={{ fontSize: 11, color: '#16a34a' }}>✓ Connected </span>}
      </div>

      {Object.keys(configuredProviders).some((pid) => configuredProviders[pid].hasKey) && (
        <div className="settings-providers">
          <label>已配置 Provider（点击切换）</label>
          <div>
            {Object.entries(configuredProviders)
              .filter(([, p]) => p.hasKey)
              .map(([pid]) => (
                <button
                  key={pid}
                  onClick={() => handleSwitchProvider(pid)}
                  disabled={loading}
                  style={{
                    marginRight: 6,
                    marginBottom: 6,
                    fontWeight: activeProvider === pid ? 700 : 400,
                  }}
                >
                  {PRESETS[pid]?.name || pid}
                  {activeProvider === pid ? ' ✓' : ''}
                </button>
              ))}
          </div>
        </div>
      )}
        <BackupSection proxyUrl={proxyUrl} />
    </div>
  );
}


