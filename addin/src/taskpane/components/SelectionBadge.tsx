/**
 * SelectionBadge — current Excel cell, shown as a formula bar.
 */

import React from 'react';

interface Props {
  address?: string;
  rows?: number;
  cols?: number;
}

export default function SelectionBadge({ address, rows, cols }: Props): JSX.Element {
  return (
    <div className="fx-live">
      <span className="fx-glyph" aria-hidden="true">fx</span>
      {address ? (
        <>
          <span className="fx-addr" title={address}>{address}</span>
          <span className="fx-dim">{rows}×{cols}</span>
        </>
      ) : (
        <span className="fx-idle">选中单元格后可提问</span>
      )}
    </div>
  );
}
