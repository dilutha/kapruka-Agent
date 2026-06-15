/**
 * Kapruka Agent — Multilingual Support System
 *
 * Architecture:
 *  - next-intl for Next.js 15 App Router i18n
 *  - Three locale bundles: en, si, singlish
 *  - Language detection runs server-side on every chat message
 *  - UI language switches instantly via Zustand (no page reload)
 *  - Agent prompts are locale-aware (see prompt-library.ts)
 *
 * Translation strategy:
 *  - Static UI strings: translation JSON files (fast, cached)
 *  - Dynamic product names: Kapruka API provides nameEn / nameSi
 *  - Agent responses: LLM generates in detected language (no post-translation)
 *
 * Singlish notes:
 *  - Singlish is NOT a formal locale with a translation file
 *  - UI remains in English; only agent tone switches to Singlish
 *  - Detection is heuristic-based (see language-detector.ts)
 */

// ─── Translation files ────────────────────────────────────────────────────────
// File: messages/en.json
export const en = {
  common: {
    loading: 'Loading…',
    error: 'Something went wrong',
    retry: 'Try again',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    or: 'or',
  },
  nav: {
    newChat: 'New chat',
    history: 'Chat history',
    profile: 'Profile',
    orders: 'My orders',
    settings: 'Settings',
    signIn: 'Sign in',
    signOut: 'Sign out',
  },
  landing: {
    hero: 'Shop Sri Lanka,\nconversationally.',
    heroSub:
      'Talk to Kaprubot — find gifts, cakes, flowers and more. Delivered anywhere in Sri Lanka.',
    cta: 'Start shopping',
    ctaGuest: 'Try as guest',
    features: {
      conversational: {
        title: 'Just talk naturally',
        desc: 'Say "Send flowers to my mom for her birthday" and we handle the rest.',
      },
      multilingual: {
        title: 'EN · සිං · Singlish',
        desc: 'Shop in the language you think in — English, Sinhala, or Singlish.',
      },
      gifts: {
        title: 'Perfect gifts, delivered',
        desc: 'Add a personal message card and schedule delivery for any date.',
      },
      tracking: {
        title: 'Track with a question',
        desc: 'Ask "Where is my order?" and get live updates instantly.',
      },
    },
  },
  chat: {
    placeholder: 'Message Kaprubot…',
    placeholderVoice: 'Listening…',
    emptyTitle: 'What can I find for you?',
    emptySub:
      'Shop Kapruka\'s full catalog — flowers, cakes, groceries, gifts — delivered across Sri Lanka.',
    suggestions: {
      flowers: '🌸 Birthday flowers',
      cake: '🎂 Anniversary cake',
      gift: '🎁 Gift under LKR 3000',
      track: '📦 Track my order',
      chocolate: '🍫 Chocolate hamper',
      avurudu: '👨‍👩‍👧 Avurudu gift ideas',
    },
    streaming: 'Thinking…',
    errorFallback:
      'I had trouble with that request. Please try again.',
    voiceError: 'Could not capture voice. Please try typing.',
    rateLimit: 'Too many messages — please wait a moment.',
  },
  product: {
    addToCart: 'Add to cart',
    addedToCart: 'Added!',
    viewDetails: 'View details',
    outOfStock: 'Out of stock',
    price: 'LKR {amount}',
    free: 'Free',
    deliveryFrom: 'Delivery from LKR {amount}',
  },
  cart: {
    title: 'Cart',
    empty: 'Your cart is empty',
    emptySub: 'Find products by chatting with Kaprubot above.',
    checkout: 'Proceed to checkout',
    total: 'Total',
    item: '{count} item',
    items: '{count} items',
    remove: 'Remove',
    giftMessage: 'Add gift message',
    editGiftMessage: 'Edit gift message',
  },
  checkout: {
    title: 'Checkout',
    steps: {
      delivery: 'Delivery',
      gift: 'Gift message',
      schedule: 'Schedule',
      payment: 'Payment',
      review: 'Review',
    },
    delivery: {
      recipientName: 'Recipient name',
      phone: 'Phone number',
      addressLine: 'Address',
      city: 'City',
      district: 'District',
      districts: {
        colombo: 'Colombo',
        gampaha: 'Gampaha',
        kalutara: 'Kalutara',
        kandy: 'Kandy',
        matale: 'Matale',
        nuwaraEliya: 'Nuwara Eliya',
        galle: 'Galle',
        matara: 'Matara',
        hambantota: 'Hambantota',
        jaffna: 'Jaffna',
        kilinochchi: 'Kilinochchi',
        mannar: 'Mannar',
        vavuniya: 'Vavuniya',
        mullaitivu: 'Mullaitivu',
        batticaloa: 'Batticaloa',
        ampara: 'Ampara',
        trincomalee: 'Trincomalee',
        kurunegala: 'Kurunegala',
        puttalam: 'Puttalam',
        anuradhapura: 'Anuradhapura',
        polonnaruwa: 'Polonnaruwa',
        badulla: 'Badulla',
        monaragala: 'Monaragala',
        ratnapura: 'Ratnapura',
        kegalle: 'Kegalle',
      },
    },
    giftMessage: {
      from: 'From',
      to: 'To',
      message: 'Message',
      messagePlaceholder: 'Write a personal message… (max 150 characters)',
      anonymous: 'Send anonymously',
      skip: 'Skip — no gift message',
    },
    payment: {
      card: 'Credit / Debit card',
      cod: 'Cash on delivery',
      payhere: 'PayHere',
      secure: '🔒 Payments are processed securely. We never store card details.',
    },
    review: {
      orderSummary: 'Order summary',
      deliveryTo: 'Delivering to',
      placeOrder: 'Place order',
      agreedTo: 'By placing this order you agree to our',
      terms: 'Terms & Conditions',
    },
    success: {
      title: 'Order placed! 🎉',
      sub: 'Your order {orderId} has been confirmed.',
      trackCta: 'Track order',
      continueCta: 'Continue shopping',
    },
  },
  tracking: {
    title: 'Order tracking',
    orderRef: 'Order #{ref}',
    status: {
      PENDING: 'Order received',
      CONFIRMED: 'Order confirmed',
      PROCESSING: 'Preparing your order',
      SHIPPED: 'On the way',
      OUT_FOR_DELIVERY: 'Out for delivery',
      DELIVERED: 'Delivered ✓',
      CANCELLED: 'Cancelled',
      REFUNDED: 'Refunded',
    },
    estimatedDelivery: 'Estimated delivery: {date}',
    noEvents: 'No tracking updates yet.',
  },
  auth: {
    signInTitle: 'Sign in to Kapruka',
    guestCheckout: 'Continue as guest',
    guestNote: 'No account needed — enter your email after placing the order to receive updates.',
    benefits: {
      title: 'With an account you get:',
      history: 'Full order history',
      faster: 'Saved addresses for faster checkout',
      tracking: 'Push notifications for delivery updates',
    },
  },
  errors: {
    notFound: 'Page not found',
    serverError: 'Server error — please try again shortly',
    sessionExpired: 'Your session expired. Please refresh.',
    networkError: 'No internet connection',
  },
};

// ─── Sinhala translations ─────────────────────────────────────────────────────
// File: messages/si.json
export const si = {
  common: {
    loading: 'පූරණය වෙමින්…',
    error: 'දෝෂයක් ඇති විය',
    retry: 'නැවත උත්සාහ කරන්න',
    cancel: 'අවලංගු කරන්න',
    confirm: 'තහවුරු කරන්න',
    save: 'සුරකින්න',
    close: 'වසන්න',
    back: 'ආපසු',
    next: 'ඊළඟ',
    or: 'හෝ',
  },
  nav: {
    newChat: 'නව සංවාදය',
    history: 'සංවාද ඉතිහාසය',
    profile: 'පැතිකඩ',
    orders: 'මගේ ඇණවුම්',
    settings: 'සැකසීම්',
    signIn: 'පිවිසෙන්න',
    signOut: 'ඉවත් වෙන්න',
  },
  landing: {
    hero: 'ශ්‍රී ලංකාවේ සාප්පු යන්න,\nසංවාදශීලීව.',
    heroSub:
      'Kaprubot සමඟ කතා කරන්න — තෑගි, කේක්, මල් සහ තවත් බොහෝ දේ. ශ්‍රී ලංකාව පුරා ලබාදෙනු ලැබේ.',
    cta: 'සාප්පු ආරම්භ කරන්න',
    ctaGuest: 'ගෙස්ට් ලෙස උත්සාහ කරන්න',
    features: {
      conversational: {
        title: 'ස්වාභාවිකව කතා කරන්න',
        desc: '"ම්මාගේ誕生日ට මල් යවන්න" කියන්න — ඉතිරිය අපි සලකා ගනිමු.',
      },
      multilingual: {
        title: 'EN · සිං · Singlish',
        desc: 'ඔබ සිතන භාෂාවෙන් සාප්පු යන්න.',
      },
      gifts: {
        title: 'පරිපූර්ණ තෑගි, ලබාදෙනු ලැබේ',
        desc: 'පෞද්ගලික පණිවිඩ කාඩ්පතක් එකතු කර ඕනෑම දිනක් ලබාදීම කාලසූචිගත කරන්න.',
      },
      tracking: {
        title: 'ප්‍රශ්නයකින් සොයා ගන්න',
        desc: '"මගේ ඇණවුම කොහේද?" කියා අසන්න, සජීවී යාවත්කාලීනයන් ලබාගන්න.',
      },
    },
  },
  chat: {
    placeholder: 'Kaprubot ට ලියන්න…',
    placeholderVoice: 'සවන් දෙමින්…',
    emptyTitle: 'ඔබට කුමක් සොයා දෙන්නද?',
    emptySub:
      'Kapruka ගබඩාවෙන් — මල්, කේක්, ද්‍රව්‍ය, තෑගි — ශ්‍රී ලංකාව පුරා ලබාදෙනු ලැබේ.',
    streaming: 'සිතමින්…',
    errorFallback: 'ඒ ඉල්ලීම ක්‍රියාත්මක කිරීමට ගැටලුවක් ඇති විය. නැවත උත්සාහ කරන්න.',
    voiceError: 'හඬ ග්‍රහණය කළ නොහැකි විය. කරුණාකර ටයිප් කරන්න.',
    rateLimit: 'ප්‍රමාද වේලාවක් රැඳෙන්න.',
  },
  product: {
    addToCart: 'කාට් එකට එකතු කරන්න',
    addedToCart: 'එකතු කෙරිණ!',
    viewDetails: 'විස්තර බලන්න',
    outOfStock: 'තොගය නැත',
    price: 'රු. {amount}',
    free: 'නොමිලේ',
    deliveryFrom: 'රු. {amount} සිට ලබාදීම',
  },
  cart: {
    title: 'කාට් එක',
    empty: 'ඔබේ කාට් එක හිස්',
    emptySub: 'ඉහත Kaprubot සමඟ කතා කර නිෂ්පාදන සොයා ගන්න.',
    checkout: 'ගෙවීම් කිරීමට',
    total: 'මුළු එකතුව',
    item: 'භාණ්ඩ {count}ක්',
    items: 'භාණ්ඩ {count}ක්',
    remove: 'ඉවත් කරන්න',
    giftMessage: 'තෑගි පණිවිඩය එකතු කරන්න',
    editGiftMessage: 'තෑගි පණිවිඩය සංස්කරණය',
  },
  tracking: {
    title: 'ඇණවුම් ලුහු.බැඳීම',
    orderRef: 'ඇණවුම #{ref}',
    status: {
      PENDING: 'ඇණවුම ලැබිණ',
      CONFIRMED: 'ඇණවුම තහවුරු කෙරිණ',
      PROCESSING: 'ඔබේ ඇණවුම සකස් කිරීම',
      SHIPPED: 'ගමන් ගතවෙමින්',
      OUT_FOR_DELIVERY: 'ලබාදීමට ගොස් ඇත',
      DELIVERED: 'ලබාදෙනු ලැබිණ ✓',
      CANCELLED: 'අවලංගු කෙරිණ',
      REFUNDED: 'ආපසු ගෙවිණ',
    },
    estimatedDelivery: 'ඇස්තමේන්තු ලබාදීම: {date}',
    noEvents: 'තවම ලුහු.බැඳීමේ යාවත්කාලීන නැත.',
  },
};

// ─── next-intl configuration ──────────────────────────────────────────────────
// File: i18n/config.ts

export const locales = ['en', 'si'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export function getTranslations(locale: Locale) {
  return locale === 'si' ? si : en;
}

// ─── Middleware for locale detection ─────────────────────────────────────────
// File: middleware.ts (Next.js root)

/**
 * Locale detection priority:
 *  1. ?lang= query param (for direct links)
 *  2. Cookie (kapruka_lang) — set when user manually switches language
 *  3. Accept-Language header — browser preference
 *  4. Default: 'en'
 */
export function detectLocaleFromRequest(
  headers: Record<string, string | string[] | undefined>,
  cookies: Record<string, string>,
  searchParams: URLSearchParams,
): Locale {
  // 1. Query param
  const queryLang = searchParams.get('lang');
  if (queryLang === 'si') return 'si';
  if (queryLang === 'en') return 'en';

  // 2. Cookie
  const cookieLang = cookies['kapruka_lang'];
  if (cookieLang === 'si') return 'si';
  if (cookieLang === 'en') return 'en';

  // 3. Accept-Language header
  const acceptLang = headers['accept-language'];
  const langStr = Array.isArray(acceptLang) ? acceptLang[0] : acceptLang ?? '';
  if (langStr.includes('si')) return 'si';

  return defaultLocale;
}

// ─── Translation helper hook ──────────────────────────────────────────────────
// File: hooks/useTranslation.ts
// Usage: const t = useTranslation(); t('chat.placeholder')

export function createTranslationHelper(translations: typeof en) {
  return function t(
    key: string,
    params?: Record<string, string | number>,
  ): string {
    const parts = key.split('.');
    let value: unknown = translations;

    for (const part of parts) {
      if (typeof value !== 'object' || value === null) return key;
      value = (value as Record<string, unknown>)[part];
    }

    if (typeof value !== 'string') return key;

    if (params) {
      return value.replace(
        /\{(\w+)\}/g,
        (_, k) => String(params[k] ?? `{${k}}`),
      );
    }

    return value;
  };
}

// ─── Singlish response tone markers ──────────────────────────────────────────
// Used by PromptLibrary to inject Singlish personality into agent responses

export const SINGLISH_OPENERS = [
  'Machan,',
  'Aney,',
  'Okay so,',
  'Right,',
  'Aiyo,',
];

export const SINGLISH_CLOSERS = [
  'ah?',
  'no?',
  'la.',
  '— nice no?',
  'what you think?',
];

export const SINGLISH_AFFIRMATIONS = [
  'Hari!',
  'Good la.',
  'Perfect machan.',
  'Okay okay.',
  'Done la.',
];

// ─── Sri Lankan occasion context ─────────────────────────────────────────────
// Injected into recommendation prompts when occasion is detected

export const SRI_LANKAN_OCCASIONS: Record<
  string,
  { en: string; si: string; emoji: string; giftCategories: string[] }
> = {
  sinhala_new_year: {
    en: 'Sinhala & Tamil New Year (Avurudu)',
    si: 'සිංහල හා දෙමළ අලුත් අවුරුද්ද',
    emoji: '🎊',
    giftCategories: ['sweets', 'traditional-gifts', 'fruit-baskets', 'flowers'],
  },
  wesak: {
    en: 'Wesak (Vesak Poya)',
    si: 'වෙසක් පොය',
    emoji: '🪔',
    giftCategories: ['flowers', 'lamps', 'sweets', 'religious-items'],
  },
  birthday: {
    en: 'Birthday',
    si: '誕生日ය',
    emoji: '🎂',
    giftCategories: ['cakes', 'flowers', 'chocolates', 'gift-hampers'],
  },
  wedding: {
    en: 'Wedding',
    si: 'විවාහය',
    emoji: '💍',
    giftCategories: ['flowers', 'gift-hampers', 'chocolates', 'home-items'],
  },
  mothers_day: {
    en: "Mother's Day",
    si: 'මව්දිනය',
    emoji: '💐',
    giftCategories: ['flowers', 'chocolates', 'cakes', 'gift-hampers'],
  },
  christmas: {
    en: 'Christmas',
    si: 'නත්තල්',
    emoji: '🎄',
    giftCategories: ['gift-hampers', 'chocolates', 'cakes', 'toys'],
  },
};