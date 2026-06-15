'use client';
export function StreamingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%', background: 'var(--k-color-text-3)',
          animation: 'k-pulse-dot 1.2s infinite ease-in-out',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
    </span>
  );
}