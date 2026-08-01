'use client';
import { useState } from 'react';
import { Product, useKaprukStore } from '@/stores/kapruk.store';
import { ProductImage } from './ProductImage';

interface Props {
  product: Product;
  onView: (product: Product) => void;
}

export function ProductCard({ product, onView }: Props) {
  const addItem = useKaprukStore((s) => s.addItem);
  const toggleWishlist = useKaprukStore((s) => s.toggleWishlist);
  const isWishlisted = useKaprukStore((s) => s.isWishlisted(product.id));
  const [justAdded, setJustAdded] = useState(false);

  const handleAdd = () => {
    addItem({
      kaprukaProdId: product.id,
      name: product.name,
      imageUrl: product.imageUrls?.[0] ?? '',
      unitPrice: product.priceMin,
      quantity: 1,
      currency: product.currency,
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  };

  // "Buy Now" opens the real Kapruka product page — this app doesn't have a
  // working checkout (payment, delivery scheduling) yet, so completing a
  // purchase happens on kapruka.com itself. "+ Cart" still uses the local
  // session cart for browsing/comparison within the chat.
  const handleBuyNow = () => {
    if (product.url) {
      window.open(product.url, '_blank', 'noopener,noreferrer');
    } else {
      handleAdd();
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: product.name,
      text: `Check out ${product.name} on Kapruka`,
      url: product.url ?? 'https://www.kapruka.com',
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        /* user cancelled — no-op */
      }
    } else {
      await navigator.clipboard.writeText(shareData.url);
    }
  };

  const isLowStock = product.stockLevel === 'low';

  return (
    <div
      className="k-card interactive k-product-card"
      style={{ width: 220, flexShrink: 0, scrollSnapAlign: 'start', display: 'flex', flexDirection: 'column' }}
    >
      {/* Image — a div, not a <button>, because the wishlist button below has
          to sit inside it visually; nesting <button> in <button> is invalid
          HTML and breaks React hydration (and real click behavior, since
          browsers don't allow nested interactive controls). */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onView(product)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onView(product);
          }
        }}
        style={{
          width: '100%', height: 160, background: 'var(--k-color-surface-2)', position: 'relative',
          overflow: 'hidden', cursor: 'pointer', flexShrink: 0,
        }}
        aria-label={`View ${product.name}`}
      >
        <ProductImage src={product.imageUrls?.[0]} alt={product.name} sizes="220px" />

        {/* Badges — every one grounded in real data, never fabricated */}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!product.isAvailable && (
            <span className="k-badge k-badge-danger" style={{ background: 'rgba(255,255,255,0.92)' }}>Out of Stock</span>
          )}
          {product.isAvailable && isLowStock && (
            <span className="k-badge k-badge-warning" style={{ background: 'rgba(255,255,255,0.92)' }}>Limited Stock</span>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleWishlist(product.id);
          }}
          aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          aria-pressed={isWishlisted}
          className="k-wishlist-btn"
          style={{
            position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: '50%',
            background: 'rgba(255,255,255,0.92)', border: 'none', display: 'grid', placeItems: 'center',
            fontSize: 15, cursor: 'pointer', color: isWishlisted ? 'var(--k-color-danger)' : 'var(--k-color-text-2)',
          }}
        >
          {isWishlisted ? '♥' : '♡'}
        </button>
      </div>

      {/* Info */}
      <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <span className="k-badge k-badge-accent" style={{ alignSelf: 'flex-start', fontSize: 10 }}>
          {product.category}
        </span>

        <button
          onClick={() => onView(product)}
          style={{
            fontSize: 13, fontWeight: 500, lineHeight: 1.35, textAlign: 'left', background: 'none', border: 'none',
            padding: 0, cursor: 'pointer', color: 'var(--k-color-text)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}
        >
          {product.name}
        </button>

        {product.description && (
          <p style={{
            fontSize: 11.5, color: 'var(--k-color-text-2)', lineHeight: 1.4, margin: 0,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {product.description}
          </p>
        )}

        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--k-color-accent-dark)' }}>
          {product.currency} {product.priceMin.toLocaleString()}
        </div>

        {/* Honest placeholders — real seller fact, neutral rating state (no fabricated stars) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--k-color-text-3)' }}>
          <span>Sold by Kapruka.com</span>
          <span title="No reviews yet">☆☆☆☆☆</span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            onClick={handleBuyNow}
            disabled={!product.isAvailable}
            className="k-btn k-btn-primary"
            style={{ flex: 1, fontSize: 12, padding: '7px 0' }}
          >
            {product.isAvailable ? 'Buy Now' : 'Sold Out'}
          </button>
          <button
            onClick={handleAdd}
            disabled={!product.isAvailable}
            className="k-btn k-btn-secondary"
            style={{ fontSize: 12, padding: '7px 10px', minWidth: 56 }}
            aria-label="Add to cart"
          >
            {justAdded ? '✓' : '+ Cart'}
          </button>
          <button
            onClick={handleShare}
            className="k-btn k-btn-ghost"
            style={{ fontSize: 12, padding: '7px 9px' }}
            aria-label="Share product"
          >
            ⤴
          </button>
        </div>
      </div>
    </div>
  );
}
