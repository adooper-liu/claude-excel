/**
 * ResultActions.tsx — "Write to Sheet" and "Copy" buttons for assistant responses.
 */

import React, { useCallback } from 'react';
import { writeToNewSheet } from '../../excel';

interface Props {
  content: string;
  hasTable: boolean;
}

export default function ResultActions({ content, hasTable }: Props): JSX.Element {
  const handleWriteToSheet = useCallback(async () => {
    try {
      // Extract table from content (first markdown table)
      const tableMatch = content.match(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/);
      if (tableMatch) {
        const headerStr = tableMatch[1];
        const bodyStr = tableMatch[2];

        const headers = headerStr.split('|').map(h => h.trim()).filter(Boolean);
        const rows = bodyStr
          .split('\n')
          .filter(r => r.trim())
          .map(r => r.split('|').map(c => c.trim()).filter(Boolean));

        const values = [headers, ...rows];
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        await writeToNewSheet(`Claude_${timestamp}`, values);
      } else {
        // Write the full text as a single column
        const lines = content.split('\n').filter(l => l.trim());
        const values = lines.map(l => [l]);
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        await writeToNewSheet(`Claude_${timestamp}`, values);
      }
    } catch (err) {
      console.error('Failed to write to sheet:', err);
      alert('Failed to write to sheet. See console for details.');
    }
  }, [content]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).catch(console.error);
  }, [content]);

  return (
    <div className="result-actions">
      {hasTable && (
        <button onClick={handleWriteToSheet} title="Write table to a new Excel sheet">
          📊 Write to Sheet
        </button>
      )}
      <button onClick={handleCopy} title="Copy response to clipboard">
        📋 Copy
      </button>
    </div>
  );
}
