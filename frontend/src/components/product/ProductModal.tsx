'use client';
import { useEffect, useState } from 'react';
import { Product, useKaprukStore } from '@/stores/kapruk.store';
import { ProductImage } from './ProductImage';

interface Props {
  product: Product;
  onClose: () => void;
}

export function ProductModal({ product, onClose }: Props) {
  const addItem = useKaprukStore((s) => s.addItem);
  const toggleWishlist = useKaprukStore((s) => s.toggleWishlist);
  const isWishlisted = useKaprukStore((s) => s.isWishlisted(product.id));
  const [activeImage, setActiveImage] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const images = product.imageUrls?.length > 0 ? product.imageUrls : [];

  return (
    <div className="k-confirm-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={product.name}>
      <div
        className="k-product-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="Close" className="k-btn k-btn-ghost k-product-modal-close">
          ✕
        </button>

        <div className="k-product-modal-body">
          {/* Gallery */}
          <div className="k-product-modal-gallery">
            <button
              className="k-product-modal-image"
              onClick={() => setIsZoomed(!isZoomed)}
              aria-label={isZoomed ? 'Zoom out' : 'Zoom in'}
            >
              <ProductImage
                src={images[activeImage]}
                alt={product.name}
                sizes="(max-width: 768px) 100vw, 480px"
                style={{ transform: isZoomed ? 'scale(1.6)' : 'scale(1)', transition: 'transform 0.25s ease' }}
              />
            </button>
            {images.length > 1 && (
              <div className="k-product-modal-thumbs">
                {images.map((img, i) => (
                  <button
                    key={img}
                    onClick={() => setActiveImage(i)}
                    className="k-product-modal-thumb"
                    style={{ borderColor: i === activeImage ? 'var(--k-color-accent)' : 'var(--k-color-border-2)' }}
                    aria-label={`Show image ${i + 1}`}
                  >
                    <ProductImage src={img} alt="" sizes="56px" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="k-product-modal-details">
            <span className="k-badge k-badge-accent" style={{ alignSelf: 'flex-start' }}>{product.category}</span>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '8px 0 4px', lineHeight: 1.3 }}>{product.name}</h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--k-color-text-3)', marginBottom: 10 }}>
              <span>Sold by Kapruka.com</span>
              <span>·</span>
              <span title="No reviews yet">☆☆☆☆☆ No reviews yet</span>
            </div>

            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--k-color-accent-dark)', marginBottom: 10 }}>
              {product.currency} {product.priceMin.toLocaleString()}
              {product.priceMax && product.priceMax > product.priceMin && (
                <span style={{ fontSize: 14, color: 'var(--k-color-text-3)', fontWeight: 400 }}>
                  {' '}– {product.currency} {product.priceMax.toLocaleString()}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {!product.isAvailable && <span className="k-badge k-badge-danger">Out of Stock</span>}
              {product.isAvailable && product.stockLevel === 'low' && <span className="k-badge k-badge-warning">Limited Stock</span>}
              {product.isAvailable && product.stockLevel !== 'low' && <span className="k-badge k-badge-success">In Stock</span>}
            </div>

            {product.description && (
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--k-color-text-2)', marginBottom: 16 }}>
                {product.description}
              </p>
            )}

            <div style={{ fontSize: 12.5, color: 'var(--k-color-text-2)', marginBottom: 16, padding: '10px 12px', background: 'var(--k-color-surface-2)', borderRadius: 'var(--k-radius-md)' }}>
              🚚 Kapruka delivers island-wide across Sri Lanka. Exact delivery windows are shown at checkout on kapruka.com.
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => product.url ? window.open(product.url, '_blank', 'noopener,noreferrer') : addItem({ kaprukaProdId: product.id, name: product.name, imageUrl: images[0] ?? '', unitPrice: product.priceMin, quantity: 1, currency: product.currency })}
                disabled={!product.isAvailable}
                className="k-btn k-btn-primary"
                style={{ flex: 1, fontSize: 13, padding: '10px 0' }}
              >
                {product.isAvailable ? 'Buy Now on Kapruka' : 'Sold Out'}
              </button>
              <button
                onClick={() => toggleWishlist(product.id)}
                className="k-btn k-btn-secondary"
                style={{ fontSize: 13, padding: '10px 14px', color: isWishlisted ? 'var(--k-color-danger)' : undefined }}
              >
                {isWishlisted ? '♥ Saved' : '♡ Wishlist'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
