'use client';
import Image from 'next/image';
import { Product, useKaprukStore } from '@/stores/kapruk.store';

interface Props { product: Product; }

export function ProductCard({ product }: Props) {
  const addItem = useKaprukStore(s => s.addItem);

  const handleAdd = () => {
    addItem({
      kaprukaProdId: product.id,
      name:          product.name,
      imageUrl:      product.imageUrls?.[0] ?? '',
      unitPrice:     product.priceMin,
      quantity:      1,
      currency:      product.currency,
    });
  };

  return (
    <div className="k-card interactive" style={{ width: 148, cursor: 'default' }}>
      {/* Product image */}
      <div style={{ width: '100%', height: 90, background: 'var(--k-color-surface-2)', position: 'relative', overflow: 'hidden' }}>
        {product.imageUrls?.[0] ? (
          <Image
            src={product.imageUrls[0]}
            alt={product.name}
            fill
            style={{ objectFit: 'cover' }}
            sizes="148px"
          />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 32 }}>🛍</div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '9px 10px' }}>
        <div style={{
          fontSize: 12, fontWeight: 500, lineHeight: 1.3, marginBottom: 4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{product.name}</div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--k-color-accent)', marginBottom: 7 }}>
          {product.currency} {product.priceMin.toLocaleString()}
        </div>
        <button
          onClick={handleAdd}
          disabled={!product.isAvailable}
          className="k-btn k-btn-secondary"
          style={{ width: '100%', fontSize: 11, padding: '6px 0', borderRadius: 7 }}
        >
          {product.isAvailable ? '+ Add to cart' : 'Out of stock'}
        </button>
      </div>
    </div>
  );
}