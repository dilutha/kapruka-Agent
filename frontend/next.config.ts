import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // next/image throws a hard, uncatchable-by-onError render error for any
    // host not explicitly listed here — that's what crashed the chat page
    // the first time (static2.kapruka.com missing) and again since (a
    // partner-fulfilled product's photo came from cdn.shopify.com, not
    // Kapruka's own CDN).
    //
    // Kapruka's catalog isn't single-sourced: most products proxy through
    // Kapruka's own image CDN, but partner/marketplace listings
    // (see partnercentral.kapruka.com in product data) can point straight at
    // the partner's own store's asset host instead — observed so far:
    // Shopify-backed partner stores serving from cdn.shopify.com. Listing
    // every Kapruka subdomain *and* Shopify's own hosting patterns here is
    // deliberate — a catalog with third-party sellers can surface more
    // hosts over time than any single test pass will see, which is also why
    // ProductImage (components/product/ProductImage.tsx) never trusts this
    // list alone: an unlisted host degrades to a fallback image instead of
    // crashing, rather than requiring this list to be perfectly exhaustive.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.kapruka.com",
      },
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
      {
        protocol: "https",
        // Shopify also serves directly from a store's own subdomain
        // (e.g. some-partner-store.myshopify.com) in addition to the
        // shared cdn.shopify.com — partner listings could use either.
        hostname: "**.myshopify.com",
      },
    ],
  },
};

export default nextConfig;
