'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useKaprukStore, useCartTotal, CheckoutInfo } from '@/stores/kapruk.store';
import { CheckoutPaymentCard } from '@/components/checkout/CheckoutPaymentCard';
import { apiClient } from '@/lib/api-client';

/**
 * Real checkout only has one implementation in this app: the conversational
 * flow in checkout.node.ts, which is the only place that ever calls
 * `kapruka_create_order` (address/phone/date collection needs entity
 * extraction a static form can't do, and duplicating that logic here would
 * mean two checkouts that can silently disagree). This page is the
 * non-chat entry point into that same flow — it never places an order
 * itself, it shows what the AI already collected (auto-fill, per spec) and
 * hands off to the chat to finish, or shows the real payment link once the
 * AI has already produced one.
 */

interface ChatContextStateResponse {
  contextState: {
    checkoutStep?: string;
    orderRef?: string;
    checkoutUrl?: string;
    orderSummary?: CheckoutInfo['summary'];
    shippingAddress?: { recipientName: string; addressLine1: string; city: string };
    deliveryDate?: string;
  } | null;
}

export default function CheckoutPage() {
  const { items, activeChatId } = useKaprukStore();
  const total = useCartTotal();
  const router = useRouter();
  const [checkoutInfo, setCheckoutInfo] = useState<CheckoutInfo | null>(null);
  const [collected, setCollected] = useState<ChatContextStateResponse['contextState']>(null);
  const [loading, setLoading] = useState(Boolean(activeChatId));

  useEffect(() => {
    // No setState here for the "nothing to fetch" case — `loading`'s
    // initial value already accounts for a missing activeChatId, so there's
    // nothing to synchronize on this render.
    if (!activeChatId) return;

    apiClient
      .get<ChatContextStateResponse>(`/chats/${activeChatId}`)
      .then((chat) => {
        const ctx = chat.contextState;
        setCollected(ctx);
        if (ctx?.checkoutStep === 'placed' && ctx.checkoutUrl && ctx.orderRef && ctx.orderSummary) {
          setCheckoutInfo({
            orderRef: ctx.orderRef,
            checkoutUrl: ctx.checkoutUrl,
            summary: ctx.orderSummary,
          });
        }
      })
      .catch((error) => console.error('Failed to load checkout context:', error))
      .finally(() => setLoading(false));
  }, [activeChatId]);

  const continueInChat = () => {
    if (activeChatId) {
      router.push(`/chat/${activeChatId}?q=${encodeURIComponent("I'd like to checkout")}`);
    } else {
      router.push('/chat');
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', padding: 24 }}>
        <div className="k-skeleton" style={{ height: 120, borderRadius: 12 }} />
      </div>
    );
  }

  if (checkoutInfo) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', padding: 24, fontFamily: 'var(--k-font-sans)' }}>
        <h1 style={{ fontFamily: 'var(--k-font-serif)', fontSize: 24, marginBottom: 16, textAlign: 'center' }}>
          Ready for payment 🎉
        </h1>
        <CheckoutPaymentCard checkoutInfo={checkoutInfo} />
        <button
          className="k-btn k-btn-ghost"
          style={{ width: '100%', marginTop: 16 }}
          onClick={() => router.push('/chat')}
        >
          Continue shopping
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', padding: 24, fontFamily: 'var(--k-font-sans)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
        <h1 style={{ fontFamily: 'var(--k-font-serif)', fontSize: 22, marginBottom: 8 }}>Your cart is empty</h1>
        <p style={{ color: 'var(--k-color-text-2)', marginBottom: 20, fontSize: 13.5 }}>
          Chat with Kapruka AI to find something first, then come back here to check out.
        </p>
        <button className="k-btn k-btn-primary" onClick={() => router.push('/chat')}>Start shopping</button>
      </div>
    );
  }

  const address = collected?.shippingAddress;

  return (
    <div style={{ maxWidth: 520, margin: '60px auto', padding: 24, fontFamily: 'var(--k-font-sans)', color: 'var(--k-color-text)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>Your order</h1>
      <p style={{ fontSize: 13, color: 'var(--k-color-text-2)', marginBottom: 20 }}>
        Kapruka AI collects your delivery details in chat, then hands you a secure Kapruka
        payment link — reviewed here, never a separate simulated checkout.
      </p>

      <div className="k-card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Items ({items.length})</h3>
        {items.map((i) => (
          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
            <span>{i.name} × {i.quantity}</span>
            <span>{i.currency} {(i.unitPrice * i.quantity).toLocaleString()}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--k-color-border)', paddingTop: 10, marginTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
          <span>Subtotal</span>
          <span style={{ color: 'var(--k-color-accent)' }}>LKR {total.toLocaleString()}</span>
        </div>
      </div>

      {address && (
        <div className="k-card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Delivery details so far <span style={{ fontWeight: 400, color: 'var(--k-color-text-3)', fontSize: 12 }}>— auto-filled from chat ✨</span>
          </h3>
          <p style={{ fontSize: 13, color: 'var(--k-color-text-2)', lineHeight: 1.6 }}>
            {address.recipientName}<br />
            {address.addressLine1}, {address.city}
            {collected?.deliveryDate && <><br />Delivery date: {collected.deliveryDate}</>}
          </p>
        </div>
      )}

      <button className="k-btn k-btn-primary" style={{ width: '100%', padding: '12px 0' }} onClick={continueInChat}>
        {address ? 'Continue checkout in chat' : 'Start checkout in chat'}
      </button>
    </div>
  );
}
