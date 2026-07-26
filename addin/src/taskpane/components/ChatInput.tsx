/**
 * ChatInput.tsx — Text input with send and stop buttons.
 */

import React, { useState, useRef, useCallback, KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled: boolean;
}

export default function ChatInput({
  onSend, onStop, isStreaming, disabled,
}: Props): JSX.Element {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!text.trim() || isStreaming) return;
    onSend(text);
    setText('');
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, isStreaming, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 100) + 'px';
    }
  }, []);

  return (
    <div className="chat-input-area">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Configure API settings first...' : 'Ask about your Excel data...'}
        disabled={disabled}
        rows={1}
      />
      {isStreaming ? (
        <button className="stop" onClick={onStop}>⏹ Stop</button>
      ) : (
        <button onClick={handleSend} disabled={disabled || !text.trim()}>
          Send
        </button>
      )}
    </div>
  );
}
