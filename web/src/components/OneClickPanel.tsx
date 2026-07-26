import React from 'react';

interface Props {
  onAnalyze: () => void;
  onClean: () => void;
  onReport: () => void;
  onStats: () => void;
  onDownload: () => void;
  disabled: boolean;
}

export default function OneClickPanel(p: Props): JSX.Element {
  return (
    <div className="oneclick-panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>AI 操作 (消耗 Token)</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button disabled={p.disabled} onClick={p.onAnalyze}>📊 AI 分析</button>
        <button disabled={p.disabled} onClick={p.onReport}>📋 AI 报告</button>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginTop: 4 }}>本地操作 (零 Token)</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button disabled={p.disabled} onClick={p.onStats}>📈 快速统计</button>
        <button disabled={p.disabled} onClick={p.onClean}>🧹 清洗下载</button>
        <button disabled={p.disabled} onClick={p.onDownload}>⬇ 原文件</button>
      </div>
    </div>
  );
}
