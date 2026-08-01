'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Chat, useKaprukStore } from '@/stores/kapruk.store';

const CATEGORIES = [
  { emoji: '🎂', label: 'Cakes', query: 'Show me cakes' },
  { emoji: '🌹', label: 'Flowers', query: 'Show me flower arrangements' },
  { emoji: '🎁', label: 'Birthday Gifts', query: 'I need a birthday gift' },
  { emoji: '💍', label: 'Anniversary', query: 'I need an anniversary gift' },
  { emoji: '👶', label: 'Baby Gifts', query: 'I need a baby gift' },
  { emoji: '🍫', label: 'Chocolates', query: 'Show me chocolate boxes' },
  { emoji: '💄', label: 'Beauty', query: 'Show me beauty products' },
  { emoji: '📱', label: 'Electronics', query: 'Show me electronics' },
  { emoji: '🏠', label: 'Home Decor', query: 'Show me home decor items' },
  { emoji: '🧸', label: 'Toys', query: 'Show me toys for kids' },
  { emoji: '🎄', label: 'Seasonal Gifts', query: 'Show me seasonal gifts' },
];

const TRENDING_SEARCHES = [
  'Birthday cake under 3000',
  'Flowers for anniversary',
  'Gift for mother',
  'Track my order',
  'Valentine gifts',
];

export default function LandingPage() {
  const router = useRouter();
  const addChat = useKaprukStore((s) => s.addChat);
  const setError = useKaprukStore((s) => s.setError);
  const [searchValue, setSearchValue] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  const startChatWithMessage = async (message: string) => {
    if (isStarting) return;
    setIsStarting(true);
    try {
      const chat = await apiClient.post<Chat>('/chats', {});
      addChat({ ...chat, messages: chat.messages ?? [] });
      router.push(`/chat/${chat.id}?q=${encodeURIComponent(message)}`);
    } catch (error) {
      console.error('Failed to start chat:', error);
      setError('Unable to start a chat. Please try again.');
      setIsStarting(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchValue.trim();
    if (q) startChatWithMessage(q);
  };

  return (
    <main style={{ background: 'var(--k-color-bg)', minHeight: '100vh', color: 'var(--k-color-text)' }}>
      {/* Hero */}
      <section style={{
        background: 'linear-gradient(180deg, var(--k-color-surface-2) 0%, var(--k-color-bg) 100%)',
        borderBottom: '1px solid var(--k-color-border)',
      }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '72px 24px 56px', textAlign: 'center' }}>
          <div style={{
            width: 72, height: 72, margin: '0 auto 20px', borderRadius: 24,
            background: 'linear-gradient(135deg,var(--k-color-accent),var(--k-color-accent-dark))',
            display: 'grid', placeItems: 'center', fontSize: 34, boxShadow: 'var(--k-shadow-accent)',
          }}>
            🛍️
          </div>
          <span className="k-badge k-badge-accent" style={{ marginBottom: 16 }}>AI Shopping Assistant</span>
          <h1 className="k-display" style={{ margin: '14px 0 16px', fontSize: 44 }}>
            Meet Kapruka AI —<br />your personal shopping consultant
          </h1>
          <p style={{ fontSize: 16.5, color: 'var(--k-color-text-2)', marginBottom: 32, lineHeight: 1.7, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
            Chat naturally in English, Sinhala, or Singlish. I&apos;ll help you find the perfect gift,
            cake, flowers, or product from Kapruka&apos;s full catalog — delivered island-wide.
          </p>

          {/* Search bar */}
          <form onSubmit={handleSearchSubmit} style={{ maxWidth: 520, margin: '0 auto 20px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, background: 'var(--k-color-surface)',
              border: '1px solid var(--k-color-border-2)', borderRadius: 'var(--k-radius-pill)',
              padding: '6px 6px 6px 18px', boxShadow: 'var(--k-shadow-md)',
            }}>
              <span style={{ fontSize: 16, color: 'var(--k-color-text-3)' }}>🔍</span>
              <input
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="What are you shopping for today?"
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14.5, padding: '8px 0' }}
              />
              <button type="submit" disabled={isStarting || !searchValue.trim()} className="k-btn k-btn-primary" style={{ fontSize: 13, padding: '9px 20px', borderRadius: 'var(--k-radius-pill)' }}>
                {isStarting ? '…' : 'Ask Kapruka AI'}
              </button>
            </div>
          </form>

          {/* Trending searches */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--k-color-text-3)', alignSelf: 'center' }}>Trending:</span>
            {TRENDING_SEARCHES.map((s) => (
              <button key={s} onClick={() => startChatWithMessage(s)} className="k-chip">
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Popular categories */}
      <section style={{ maxWidth: 1000, margin: '0 auto', padding: '56px 24px' }}>
        <h2 style={{ fontFamily: 'var(--k-font-serif)', fontSize: 26, textAlign: 'center', marginBottom: 8 }}>
          What can I help you find?
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--k-color-text-2)', fontSize: 13.5, marginBottom: 32 }}>
          Tap a category to start a conversation
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.label}
              onClick={() => startChatWithMessage(cat.query)}
              disabled={isStarting}
              className="k-card interactive"
              style={{
                padding: '22px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 8, cursor: 'pointer', border: '1px solid var(--k-color-border)', background: 'var(--k-color-surface)',
              }}
            >
              <span style={{ fontSize: 30 }}>{cat.emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{cat.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Feature strip */}
      <section style={{ background: 'var(--k-color-surface-2)', borderTop: '1px solid var(--k-color-border)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px', display: 'flex', gap: 32, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            { emoji: '💬', title: 'Just talk naturally', desc: 'Say what you want in any language' },
            { emoji: '🗣️', title: 'EN · සිං · Singlish', desc: 'Shop in the language you think in' },
            { emoji: '🎁', title: 'Perfect gifts', desc: 'Add a message card, schedule delivery' },
            { emoji: '📦', title: 'Live tracking', desc: 'Ask "where is my order?" anytime' },
          ].map((f) => (
            <div key={f.title} style={{ flex: '1 1 180px', maxWidth: 200, textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>{f.emoji}</div>
              <div style={{ fontWeight: 500, marginBottom: 4, fontSize: 14 }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--k-color-text-2)' }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ textAlign: 'center', padding: '48px 24px' }}>
        <button
          onClick={() => startChatWithMessage('Hi!')}
          disabled={isStarting}
          className="k-btn k-btn-primary"
          style={{ padding: '14px 32px', fontSize: 15 }}
        >
          {isStarting ? 'Starting…' : 'Start shopping with Kapruka AI'}
        </button>
      </section>
    </main>
  );
}
