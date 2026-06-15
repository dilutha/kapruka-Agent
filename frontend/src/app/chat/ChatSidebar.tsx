'use client';
import { Chat, useKaprukStore, useLanguage } from '@/stores/kapruk.store';
import { apiClient } from '@/lib/api-client';
import { useRouter } from 'next/navigation';

export function ChatSidebar() {
  const { chats, activeChatId, addChat, setLanguage } = useKaprukStore();
  const language = useLanguage();
  const router = useRouter();

  const handleNewChat = async () => {
    try {
      const chat = await apiClient.post<Chat>('/chats', {});
      addChat({ ...chat, messages: chat.messages ?? [] });
      router.push(`/chat/${chat.id}`);
    } catch (e) { console.error('Failed to create chat:', e); }
  };

  return (
    <aside style={{
      width: 220, background: 'var(--k-color-surface)',
      borderRight: '1px solid var(--k-color-border)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 16px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'linear-gradient(135deg,var(--k-color-accent),var(--k-color-accent-dark))',
          display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14, fontWeight: 700,
        }}>K</div>
        <span style={{ fontSize: 15, fontWeight: 500 }}>Kaprubot</span>
      </div>

      {/* New Chat */}
      <button onClick={handleNewChat} className="k-btn k-btn-secondary" style={{ margin: '0 12px 12px', fontSize: 13 }}>
        + New chat
      </button>

      {/* Chat list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        {chats.map(chat => (
          <div
            key={chat.id}
            onClick={() => router.push(`/chat/${chat.id}`)}
            style={{
              padding: '9px 10px', borderRadius: 9, marginBottom: 2, cursor: 'pointer',
              fontSize: 13, color: chat.id === activeChatId ? 'var(--k-color-text)' : 'var(--k-color-text-2)',
              background: chat.id === activeChatId ? 'var(--k-color-surface-2)' : 'transparent',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              transition: 'all var(--k-transition-base)',
            }}
          >
            {chat.title ?? 'New chat'}
          </div>
        ))}
      </div>

      {/* Language switcher */}
      <div style={{ padding: 12, borderTop: '1px solid var(--k-color-border)' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['EN', 'SI', 'SINGLISH'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                border: `1px solid ${language === lang ? 'var(--k-color-accent)' : 'var(--k-color-border-2)'}`,
                background: language === lang ? 'var(--k-color-accent)' : 'transparent',
                color: language === lang ? '#fff' : 'var(--k-color-text-2)',
                transition: 'all var(--k-transition-base)',
              }}
            >
              {lang === 'SINGLISH' ? 'SL' : lang === 'SI' ? 'සිං' : lang}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
