import React, { useEffect, useState } from 'react';
import { describeFile } from '../services/api';

interface Props { fileId: string }

export default function DataPreview({ fileId }: Props): JSX.Element | null {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { describeFile(fileId).then(setData).catch(() => {}); }, [fileId]);
  if (!data?.sheets) return null;

  const sheets = data.sheets as Record<string, { rows: number; cols: number; column_names: string[]; null_pct: Record<string, number> }>;

  return (
    <div className="data-preview">
      <h3>📋 数据概览</h3>
      {Object.entries(sheets).map(([name, info]) => (
        <div key={name} className="sheet-info">
          <strong>{name}</strong>: {info.rows} 行 × {info.cols} 列
          <div className="columns">{info.column_names?.join(', ')}</div>
        </div>
      ))}
    </div>
  );
}
