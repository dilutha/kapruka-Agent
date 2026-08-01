'use client';
import Image from 'next/image';
import { Component, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Tiny neutral-gray placeholder, base64-inlined. `placeholder="blur"` needs
 * a `blurDataURL` for any *remote* image (Next.js can only auto-generate one
 * for static imports resolved at build time) — this is that value, shared
 * across every product photo rather than generated per-image.
 */
const BLUR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function ImagePlaceholder() {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        width: '100%',
        fontSize: 40,
        background: 'var(--k-color-surface-2)',
        color: 'var(--k-color-text-3)',
      }}
    >
      🛍️
    </div>
  );
}

/**
 * Kapruka's catalog includes partner/marketplace listings whose photos can
 * live on a host `next.config.ts` doesn't (yet) list — next/image throws a
 * synchronous render-time error for that ("Invalid src prop ... hostname ...
 * is not configured"), which is NOT something an `<Image onError>` handler
 * ever sees: that handler only fires for a genuine *load* failure (404,
 * broken link) on an *already-accepted* host, after React has successfully
 * rendered the element. A render-time throw needs a React error boundary —
 * this is that boundary, scoped to just the image so one bad product photo
 * degrades to a placeholder instead of taking the whole product card (or the
 * whole chat page) down with it.
 */
class ImageErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('ProductImage: unconfigured or invalid image host', error);
  }

  render() {
    if (this.state.hasError) return <ImagePlaceholder />;
    return this.props.children;
  }
}

interface ProductImageProps {
  src: string | undefined;
  alt: string;
  /** `sizes` for `next/image`'s responsive `srcset` — match the rendered width. */
  sizes: string;
  style?: CSSProperties;
}

/**
 * Drop-in replacement for a raw `<Image fill>` product photo. Never crashes:
 * an absent/empty `src`, an unconfigured remote host, or a genuine load
 * failure (404, dead link, network error) all converge on the same
 * placeholder instead of an uncaught error or a broken-image icon.
 */
export function ProductImage({ src, alt, sizes, style }: ProductImageProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (!src || loadFailed) {
    return <ImagePlaceholder />;
  }

  return (
    <ImageErrorBoundary key={src}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        style={{ objectFit: 'cover', ...style }}
        loading="lazy"
        placeholder="blur"
        blurDataURL={BLUR_DATA_URL}
        onError={() => setLoadFailed(true)}
      />
    </ImageErrorBoundary>
  );
}
