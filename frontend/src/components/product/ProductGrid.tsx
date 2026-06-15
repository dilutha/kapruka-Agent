'use client';
import { Product } from '@/stores/kapruk.store';
import { ProductCard } from './ProductCard';

interface Props { products: Product[]; }

export function ProductGrid({ products }: Props) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 480 }}>
      {products.slice(0, 6).map(p => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}