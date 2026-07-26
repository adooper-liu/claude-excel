/**
 * SelectionBadge.tsx — Displays the current Excel selection with a clear button.
 */

import React from 'react';

interface Props {
  address: string;
  rows: number;
  cols: number;
  onClear: () => void;
}

export default function SelectionBadge({ address, rows, cols, onClear }: Props): JSX.Element {
  return (
    <div className="selection-badge">
      <span>📎 Selected: {address} ({rows} rows × {cols} cols)</span>
      <button onClick={onClear} title="Clear selection focus">✕</button>
    </div>
  );
}
