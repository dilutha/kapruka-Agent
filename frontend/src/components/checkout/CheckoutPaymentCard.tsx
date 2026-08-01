import { CheckoutInfo } from '@/stores/kapruk.store';

interface Props {
  checkoutInfo: CheckoutInfo;
}

/**
 * The honest end of AI checkout: a real Kapruka click-to-pay link, never a
 * simulated payment or fabricated confirmation. Shared between the inline
 * chat message (MessageBubble) and the /checkout page so both render the
 * exact same real order data the same way.
 */
export function CheckoutPaymentCard({ checkoutInfo }: Props) {
  return (
    <div
      className="k-card"
      style={{
        padding: 16,
        minWidth: 260,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        border: '1px solid var(--k-color-accent)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--k-color-text-3)' }}>
        Order {checkoutInfo.orderRef}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--k-color-accent-dark)' }}>
        {checkoutInfo.summary.currency} {checkoutInfo.summary.grandTotal.toLocaleString()}
      </div>
      <a
        href={checkoutInfo.checkoutUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="k-btn k-btn-primary"
        style={{ textAlign: 'center', padding: '10px 0', fontSize: 13 }}
      >
        Complete Payment on Kapruka →
      </a>
      <span style={{ fontSize: 11, color: 'var(--k-color-text-3)' }}>
        🔒 Secure payment on Kapruka.com — link valid for 60 minutes
      </span>
    </div>
  );
}
