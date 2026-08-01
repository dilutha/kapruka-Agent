'use client';
import { useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Chat, useKaprukStore, useActiveChat, useIsStreaming } from '@/stores/kapruk.store';
import { useChatStream } from '@/hooks/useChatStream';
import { MessageBubble } from '../MessageBubble';
import { ChatInput } from '../ChatInput';
import { apiClient } from '@/lib/api-client';

const WELCOME_ACTIONS = [
  { emoji: '🎂', label: 'Birthday Cake', text: 'I need a birthday cake' },
  { emoji: '🌹', label: 'Flowers', text: 'Show me flower arrangements' },
  { emoji: '🎁', label: 'Gifts', text: 'Help me find a gift' },
  { emoji: '💍', label: 'Anniversary', text: 'I need an anniversary gift' },
  { emoji: '❤️', label: "Valentine's", text: "Show me Valentine's gifts" },
  { emoji: '👶', label: 'Baby Gifts', text: 'I need a baby gift' },
  { emoji: '🍫', label: 'Chocolate', text: 'Show me chocolate boxes' },
  { emoji: '🏠', label: 'Home', text: 'Show me home decor items' },
];

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addChat, setActiveChat, toggleDrawer } = useKaprukStore();
  const chat = useActiveChat();
  const isStreaming = useIsStreaming();
  const { sendMessage } = useChatStream();
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasSentInitialQueryRef = useRef(false);

  // Tracks the chat id this effect has already fetched (or is fetching).
  // Without this, React Strict Mode's dev-only double effect invocation fires
  // GET /chats/:id twice on the same mount, and both `.then` handlers call
  // addChat() for the identical id — that's what produced two Chat objects
  // sharing one UUID in `chats`, i.e. the duplicate React key. Comparing
  // against `id` (rather than a plain boolean) still lets a genuine
  // navigation to a different chat re-fetch normally.
  const loadedChatIdRef = useRef<string | null>(null);

  // Load chat on mount
  useEffect(() => {
    if (!id) return;
    setActiveChat(id);

    if (loadedChatIdRef.current === id) return;
    loadedChatIdRef.current = id;

    apiClient
      .get<Chat>(`/chats/${id}`)
      .then((c) => {
        addChat({ ...c, messages: c.messages ?? [] });
      })
      .catch((error) => {
        loadedChatIdRef.current = null; // allow retry on genuine failure
        console.error(error);
      });
  }, [addChat, id, setActiveChat]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages.length]);

  const handleSend = (content: string) => {
    if (id) sendMessage({ chatId: id, content });
  };

  // Landing page / category quick-actions create a chat then navigate here
  // with `?q=<message>` to auto-send the first turn. Ref-guarded the same
  // way as the load-on-mount effect above, for the same Strict Mode reason —
  // without it, the query text would get sent twice on the very first
  // render. The param is stripped from the URL right after sending so a
  // page refresh doesn't resend it.
  useEffect(() => {
    const q = searchParams.get('q');
    if (!q || !id || hasSentInitialQueryRef.current) return;
    hasSentInitialQueryRef.current = true;

    sendMessage({ chatId: id, content: q });
    router.replace(`/chat/${id}`);
  }, [id, searchParams, sendMessage, router]);

  return (
    <>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--k-color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--k-color-text)' }}>{chat?.title ?? 'New chat'}</span>
        <button className="k-btn k-btn-ghost" style={{ fontSize: 18 }} onClick={() => toggleDrawer()} aria-label="Open cart">🛒</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(!chat || chat.messages.length === 0) && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 32 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 20,
              background: 'linear-gradient(135deg,var(--k-color-accent),var(--k-color-accent-dark))',
              display: 'grid', placeItems: 'center', fontSize: 26, boxShadow: 'var(--k-shadow-accent)',
            }}>👋</div>
            <div style={{ textAlign: 'center' }}>
              <h2 style={{ fontFamily: 'var(--k-font-serif)', fontSize: 24, letterSpacing: '-0.5px', marginBottom: 6 }}>
                Hi, I&apos;m Kapruka AI
              </h2>
              <p style={{ fontSize: 13.5, color: 'var(--k-color-text-2)', maxWidth: 320, lineHeight: 1.6 }}>
                I can help you find the perfect gift, flowers, cakes, electronics and thousands of products from Kapruka.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 420 }}>
              {WELCOME_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleSend(action.text)}
                  className="k-btn k-btn-secondary"
                  style={{ fontSize: 12.5 }}
                >
                  {action.emoji} {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {chat?.messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            chatId={id}
            regenerateSource={m.role === 'assistant' ? chat.messages[i - 1]?.content : undefined}
            onQuickAction={handleSend}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </>
  );
}
