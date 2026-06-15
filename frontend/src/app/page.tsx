import Link from 'next/link';

export default function LandingPage() {
  return (
    <main style={{ background: 'var(--k-color-bg)', minHeight: '100vh', color: 'var(--k-color-text)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
        <h1 className="k-display" style={{ marginBottom: 24 }}>
          Shop Sri Lanka,<br/>conversationally.
        </h1>
        <p style={{ fontSize: 18, color: 'var(--k-color-text-2)', marginBottom: 48, lineHeight: 1.7 }}>
          Talk to Kaprubot — find gifts, cakes, flowers and more.
          Delivered anywhere in Sri Lanka.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/chat" className="k-btn k-btn-primary" style={{ padding: '12px 28px', fontSize: 15 }}>
            Start shopping
          </Link>
          <Link href="/chat" className="k-btn k-btn-secondary" style={{ padding: '12px 28px', fontSize: 15 }}>
            Try as guest
          </Link>
        </div>
        <div style={{ display: 'flex', gap: 32, justifyContent: 'center', marginTop: 80, flexWrap: 'wrap' }}>
          {[
            { emoji: '💬', title: 'Just talk naturally', desc: 'Say what you want in any language' },
            { emoji: '🌸', title: 'EN · සිං · Singlish', desc: 'Shop in the language you think in' },
            { emoji: '🎁', title: 'Perfect gifts', desc: 'Add a message card, schedule delivery' },
            { emoji: '📦', title: 'Live tracking', desc: 'Ask "where is my order?" anytime' },
          ].map(f => (
            <div key={f.title} style={{ flex: '1 1 180px', maxWidth: 200 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{f.emoji}</div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: 'var(--k-color-text-2)' }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}