'use client';
import { useRef, useState } from 'react';
import { Product } from '@/stores/kapruk.store';
import { ProductCard } from './ProductCard';
import { ProductModal } from './ProductModal';

interface Props {
  products: Product[];
}

export function ProductCarousel({ products }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Product | null>(null);

  const scrollByAmount = (direction: 1 | -1) => {
    scrollerRef.current?.scrollBy({ left: direction * 240, behavior: 'smooth' });
  };

  if (products.length === 0) return null;

  return (
    <div className="k-carousel-wrap">
      {products.length > 1 && (
        <>
          <button
            className="k-carousel-nav k-carousel-nav-prev"
            onClick={() => scrollByAmount(-1)}
            aria-label="Scroll products left"
          >
            ‹
          </button>
          <button
            className="k-carousel-nav k-carousel-nav-next"
            onClick={() => scrollByAmount(1)}
            aria-label="Scroll products right"
          >
            ›
          </button>
        </>
      )}

      <div ref={scrollerRef} className="k-carousel" role="list">
        {products.map((p) => (
          <div role="listitem" key={p.id}>
            <ProductCard product={p} onView={setSelected} />
          </div>
        ))}
      </div>

      {selected && (
        <ProductModal product={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
