import React, { useState, useRef, useCallback, KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled: boolean;
}

export default function ChatInput({ onSend, onStop, isStreaming, disabled }: Props): JSX.Element {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(() => { if (text.trim() && !isStreaming) { onSend(text); setText(''); }}, [text, isStreaming, onSend]);
  const key = useCallback((e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }}, [send]);

  return (
    <div className="chat-input-area">
      <textarea ref={ref} value={text} onChange={e => setText(e.target.value)} onKeyDown={key}
        placeholder={disabled ? '请先在设置中配置 API Key...' : '输入问题，比如"分析销售趋势"...'} rows={1} />
      {isStreaming ? <button className="stop" onClick={onStop}>⏹</button>
        : <button onClick={send} disabled={disabled || !text.trim()}>发送</button>}
    </div>
  );
}
