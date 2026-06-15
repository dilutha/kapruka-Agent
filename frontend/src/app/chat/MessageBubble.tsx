'use client';
import { ChatMessage } from '@/stores/kapruk.store';
import { ProductGrid } from '@/components/product/ProductGrid';
import { StreamingDots } from './StreamingDots';

interface Props { message: ChatMessage; }

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';
  return (
    <div style={{ display: 'flex', gap: 10, flexDirection: isUser ? 'row-reverse' : 'row', maxWidth: '100%' }}>
      {/* Avatar */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
        fontSize: 12, fontWeight: 600, marginTop: 2,
        background: isUser ? 'var(--k-color-surface-2)' : 'linear-gradient(135deg,var(--k-color-accent),var(--k-color-accent-dark))',
        border: isUser ? '1px solid var(--k-color-border-2)' : 'none',
        color: isUser ? 'var(--k-color-text-2)' : '#fff',
      }}>
        {isUser ? 'U' : 'K'}
      </div>

      {/* Content */}
      <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', gap: 8, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        <div style={{
          padding: '11px 14px',
          background: isUser ? 'var(--k-color-accent)' : 'var(--k-color-surface)',
          border: isUser ? 'none' : '1px solid var(--k-color-border)',
          color: isUser ? '#fff' : 'var(--k-color-text)',
          fontSize: 14, lineHeight: 1.6,
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px',
        }}>
          {message.isStreaming && !message.content
            ? <StreamingDots />
            : <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
          }
        </div>

        {/* Product cards inline under bot message */}
        {message.products && message.products.length > 0 && (
          <ProductGrid products={message.products} />
        )}
      </div>
    </div>
  );
}
