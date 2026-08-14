import React from 'react';
import type { SheetRecord } from '../../excel/sheet-history';

interface Props {
  items: SheetRecord[];
  onUndo: (sheet: string) => void;
  onClose: () => void;
}

export default function HistoryPanel({ items, onUndo, onClose }: Props): JSX.Element {
  return (
    <div className="flyout history-flyout" role="dialog" aria-label="操作历史">
      <div className="flyout-head">
        <span>最近写的表</span>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">✕</button>
      </div>
      {items.length === 0 ? (
        <p className="flyout-empty">还没有新表。对账、去重、求和会记在这里。</p>
      ) : (
        <ul className="history-list">
          {items.map((item) => (
            <li key={item.sheet}>
              <span className="history-name" title={'写之前在「' + item.previous + '」'}>{item.sheet}</span>
              <button type="button" onClick={() => onUndo(item.sheet)}>撤销</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
