'use client';
import { useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Chat, useKaprukStore, useActiveChat, useIsStreaming } from '@/stores/kapruk.store';
import { useChatStream } from '@/hooks/useChatStream';
import { MessageBubble } from '../MessageBubble';
import { ChatInput } from '../ChatInput';
import { apiClient } from '@/lib/api-client';

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const { addChat, setActiveChat, toggleDrawer } = useKaprukStore();
  const chat = useActiveChat();
  const isStreaming = useIsStreaming();
  const { sendMessage } = useChatStream();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load chat on mount
  useEffect(() => {
    if (!id) return;
    setActiveChat(id);
    apiClient.get<Chat>(`/chats/${id}`).then(c => {
      addChat({ ...c, messages: c.messages ?? [] });
    }).catch(console.error);
  }, [addChat, id, setActiveChat]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages.length]);

  const handleSend = (content: string) => {
    if (id) sendMessage({ chatId: id, content });
  };

  return (
    <>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--k-color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: 'var(--k-color-text-2)' }}>{chat?.title ?? 'New chat'}</span>
        <button className="k-btn k-btn-ghost" style={{ fontSize: 18 }} onClick={() => toggleDrawer()}>🛒</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(!chat || chat.messages.length === 0) && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
            <h2 style={{ fontFamily: 'var(--k-font-serif)', fontSize: 22, letterSpacing: '-0.5px' }}>What can I find for you?</h2>
            <p style={{ fontSize: 13, color: 'var(--k-color-text-2)', textAlign: 'center', maxWidth: 260 }}>
              Shop Kapruka&apos;s full catalog — flowers, cakes, groceries, gifts — delivered across Sri Lanka.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'center' }}>
              {['🌸 Birthday flowers', '🎂 Anniversary cake', '🎁 Gift under LKR 3000', '📦 Track my order', '🍫 Chocolate hamper'].map(s => (
                <button key={s} onClick={() => handleSend(s.replace(/^[^\w]+/, ''))}
                  style={{ padding: '6px 13px', borderRadius: 20, border: '1px solid var(--k-color-border-2)', background: 'var(--k-color-surface)', fontSize: 12, color: 'var(--k-color-text-2)', cursor: 'pointer' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {chat?.messages.map(m => <MessageBubble key={m.id} message={m} />)}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </>
  );
}
