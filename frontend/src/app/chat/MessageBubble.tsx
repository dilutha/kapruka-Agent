'use client';
import { useState } from 'react';
import { ChatMessage, useKaprukStore } from '@/stores/kapruk.store';
import { ProductCarousel } from '@/components/product/ProductCarousel';
import { CheckoutPaymentCard } from '@/components/checkout/CheckoutPaymentCard';
import { FormattedMessage } from '@/lib/markdown';
import { StreamingDots } from './StreamingDots';

interface Props {
  message: ChatMessage;
  chatId: string;
  /** Content of the user message this reply answers — powers "Regenerate". */
  regenerateSource?: string;
  onQuickAction?: (text: string) => void;
}

const PRODUCT_FOLLOWUPS = ['Show cheaper options', 'Show premium options', 'Same-day delivery?', 'Add flowers 🌸', 'Add chocolate 🍫'];
const TEXT_FOLLOWUPS = ['Show me gift ideas', 'Track my order', 'What can you help with?'];

export function MessageBubble({ message, chatId, regenerateSource, onQuickAction }: Props) {
  const isUser = message.role === 'user';
  const setMessageFeedback = useKaprukStore((s) => s.setMessageFeedback);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text: message.content });
      } catch {
        /* cancelled */
      }
    } else {
      await navigator.clipboard.writeText(message.content);
    }
  };

  const followUps = message.responseType === 'product_list' ? PRODUCT_FOLLOWUPS : TEXT_FOLLOWUPS;
  const showFollowUps = !isUser && !message.isStreaming && message.content.length > 0 && onQuickAction;

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
      <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 8, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        <div style={{
          padding: '11px 14px',
          background: isUser ? 'var(--k-color-accent)' : 'var(--k-color-surface)',
          border: isUser ? 'none' : '1px solid var(--k-color-border)',
          color: isUser ? '#fff' : 'var(--k-color-text)',
          fontSize: 14, lineHeight: 1.6,
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          boxShadow: isUser ? 'none' : 'var(--k-shadow-sm)',
        }}>
          {message.isStreaming && !message.content
            ? <StreamingDots />
            : isUser
              ? <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
              : <FormattedMessage content={message.content} />
          }
        </div>

        {/* Product cards inline under bot message */}
        {message.products && message.products.length > 0 && (
          <ProductCarousel products={message.products} />
        )}

        {/* Real Kapruka click-to-pay link — the honest end of AI checkout:
            Kapruka's own secure payment page, never a simulated order. */}
        {message.checkoutInfo && (
          <CheckoutPaymentCard checkoutInfo={message.checkoutInfo} />
        )}

        {/* Message actions — assistant replies only, once the reply is done */}
        {!isUser && !message.isStreaming && message.content.length > 0 && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={handleCopy} className="k-btn k-btn-ghost k-msg-action" aria-label="Copy message" title="Copy">
              {copied ? '✓' : '📋'}
            </button>
            {regenerateSource && onQuickAction && (
              <button onClick={() => onQuickAction(regenerateSource)} className="k-btn k-btn-ghost k-msg-action" aria-label="Regenerate response" title="Regenerate">
                ↻
              </button>
            )}
            <button
              onClick={() => setMessageFeedback(chatId, message.id, 'like')}
              className="k-btn k-btn-ghost k-msg-action"
              aria-label="Good response"
              aria-pressed={message.feedback === 'like'}
              title="Good response"
              style={{ color: message.feedback === 'like' ? 'var(--k-color-success)' : undefined }}
            >
              👍
            </button>
            <button
              onClick={() => setMessageFeedback(chatId, message.id, 'dislike')}
              className="k-btn k-btn-ghost k-msg-action"
              aria-label="Poor response"
              aria-pressed={message.feedback === 'dislike'}
              title="Poor response"
              style={{ color: message.feedback === 'dislike' ? 'var(--k-color-danger)' : undefined }}
            >
              👎
            </button>
            <button onClick={handleShare} className="k-btn k-btn-ghost k-msg-action" aria-label="Share message" title="Share">
              ⤴
            </button>
          </div>
        )}

        {/* Suggested follow-up chips */}
        {showFollowUps && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {followUps.map((chip) => (
              <button
                key={chip}
                onClick={() => onQuickAction?.(chip)}
                className="k-chip"
              >
                {chip}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
