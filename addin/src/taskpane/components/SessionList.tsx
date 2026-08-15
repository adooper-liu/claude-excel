import React from "react";
import type { ChatSession } from "../../services/chat-sessions";

interface Props {
  items: ChatSession[];
  activeId: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return mm + "-" + dd + " " + hh + ":" + mi;
}

export default function SessionList({ items, activeId, onOpen, onDelete, onClose }: Props): JSX.Element {
  return (
    <div className="flyout session-flyout" role="dialog" aria-label="历史会话">
      <div className="flyout-head">
        <span>历史会话</span>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">✕</button>
      </div>
      {items.length === 0 ? (
        <p className="flyout-empty">还没有会话。点「＋」开新对话，发过消息的会记在这里。</p>
      ) : (
        <ul className="history-list">
          {items.map((item) => (
            <li key={item.id} className={item.id === activeId ? "session-active" : undefined}>
              <button
                type="button"
                className="history-name session-open"
                title={item.title}
                onClick={() => onOpen(item.id)}
              >
                <span className="session-title">{item.title}</span>
                <span className="session-when">{formatWhen(item.updatedAt)}</span>
              </button>
              <button type="button" onClick={() => onDelete(item.id)}>删除</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
