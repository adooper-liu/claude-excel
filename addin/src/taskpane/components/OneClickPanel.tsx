import React from 'react';

interface Props {
  onAnalyze: () => void; onReport: () => void;
  onSortAsc: () => void; onSortDesc: () => void;
  onClean: () => void; onFormat: () => void; onDataBar: () => void;
  disabled: boolean;
}

export default function OneClickPanel(p: Props): JSX.Element {
  const btn = (label: string, onClick: () => void, ai?: boolean) => (
    <button className={`oneclick-btn${ai ? ' ai' : ''}`} onClick={onClick} disabled={p.disabled}
      title={ai ? 'AI-powered (uses tokens)' : 'Local execution (zero tokens)'}>
      {label}
    </button>
  );
  return (
    <div className="oneclick-panel">
      {btn('📊 分析', p.onAnalyze, true)}
      {btn('📋 报告', p.onReport, true)}
      {btn('🧹 清洗', p.onClean)}
      {btn('📈↑ 升序', p.onSortAsc)}
      {btn('📈↓ 降序', p.onSortDesc)}
      {btn('B 加粗', p.onFormat)}
      {btn('📊 数据条', p.onDataBar)}
    </div>
  );
}
