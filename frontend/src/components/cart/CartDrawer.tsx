'use client';
import { useKaprukStore, useCartTotal, useCartCount } from '@/stores/kapruk.store';
import { useRouter } from 'next/navigation';

export function CartDrawer() {
  const { items, toggleDrawer, updateQuantity } = useKaprukStore();
  const total = useCartTotal();
  const count = useCartCount();
  const router = useRouter();

  return (
    <aside style={{
      width: 280, background: 'var(--k-color-surface)',
      borderLeft: '1px solid var(--k-color-border)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      animation: 'k-slide-in-right var(--k-transition-slow)',
    }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--k-color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 500 }}>Cart ({count})</span>
        <button onClick={() => toggleDrawer(false)} className="k-btn k-btn-ghost" style={{ padding: '4px 8px' }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {items.length === 0
          ? <p style={{ color: 'var(--k-color-text-3)', fontSize: 13, textAlign: 'center', padding: 20 }}>Your cart is empty</p>
          : items.map(item => (
            <div key={item.id} style={{ display: 'flex', gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--k-color-border)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--k-color-surface-2)', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 18 }}>🛍</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                <div style={{ fontSize: 13, color: 'var(--k-color-accent)', fontWeight: 500 }}>LKR {(item.unitPrice * item.quantity).toLocaleString()}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <button onClick={() => updateQuantity(item.kaprukaProdId, item.quantity - 1)} style={{ width: 20, height: 20, border: '1px solid var(--k-color-border-2)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--k-color-text-2)' }}>−</button>
                  <span style={{ fontSize: 12, minWidth: 16, textAlign: 'center' }}>{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.kaprukaProdId, item.quantity + 1)} style={{ width: 20, height: 20, border: '1px solid var(--k-color-border-2)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--k-color-text-2)' }}>+</button>
                </div>
              </div>
            </div>
          ))
        }
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--k-color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 12 }}>
          <span style={{ color: 'var(--k-color-text-2)' }}>Total</span>
          <span style={{ fontWeight: 500, color: 'var(--k-color-accent)' }}>LKR {total.toLocaleString()}</span>
        </div>
        <button
          className="k-btn k-btn-primary"
          style={{ width: '100%', padding: 10, fontSize: 13 }}
          disabled={items.length === 0}
          onClick={() => { toggleDrawer(false); router.push('/checkout'); }}
        >
          Proceed to checkout
        </button>
      </div>
    </aside>
  );
}
