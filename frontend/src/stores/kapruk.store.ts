/**
 * Kapruka Agent — Global State Store (Zustand)
 *
 * Architecture: Three distinct slices, composed into one store.
 * Each slice is independently testable and has clear ownership.
 *
 *  ChatSlice   — active chat, messages, streaming state
 *  CartSlice   — cart items, drawer visibility
 *  UISlice     — language, theme, voice mode, loading states
 *
 * Persistence:
 *  - ChatSlice: no persistence (fetched from API on mount)
 *  - CartSlice: localStorage (survives page refresh for guests)
 *  - UISlice: localStorage (language + theme preference)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Language = 'EN' | 'SI' | 'SINGLISH';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ResponseType = 'text' | 'product_list' | 'cart' | 'order_status' | 'checkout';

export interface Product {
  id: string;
  name: string;
  priceMin: number;
  priceMax?: number;
  currency: string;
  imageUrls: string[];
  category: string;
  isAvailable: boolean;
  description?: string;
  /** Real kapruka.com product page — used for "Buy Now"/"View Product". */
  url?: string;
  /** Real catalog signal ("low"/"medium"/"high") when the tool reports it. */
  stockLevel?: string;
}

/** Real Kapruka click-to-pay checkout — see backend's `checkout_ready` SSE event. */
export interface CheckoutInfo {
  orderRef: string;
  checkoutUrl: string;
  summary: {
    itemsTotal: number;
    deliveryFee: number;
    addonsTotal: number;
    grandTotal: number;
    currency: string;
  };
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  responseType?: ResponseType;
  products?: Product[];        // Populated for product_list type
  cartSnapshot?: CartItem[];   // Populated for cart type
  checkoutInfo?: CheckoutInfo; // Populated when the AI just created a real order
  isStreaming?: boolean;       // True while SSE chunks are arriving
  feedback?: 'like' | 'dislike' | null; // User reaction to an assistant reply
  createdAt: Date;
}

export interface Chat {
  id: string;
  title?: string;
  detectedLanguage: Language;
  messages: ChatMessage[];
  status?: string;
  isPinned?: boolean;
  createdAt: Date;
}

export interface CartItem {
  id: string;              // Local ID
  kaprukaProdId: string;
  name: string;
  imageUrl: string;
  unitPrice: number;
  quantity: number;
  currency: string;
  giftMessage?: GiftMessageInput;
}

export interface GiftMessageInput {
  fromName: string;
  toName: string;
  message: string;
  isAnonymous: boolean;
}

/**
 * Merges a freshly-fetched/created `Chat` into the copy already held in the
 * store. `incoming` (server data) wins for scalar fields; for `messages`,
 * any message that only exists locally (e.g. an assistant reply still
 * streaming, not yet persisted server-side) is preserved rather than dropped,
 * so an upsert can never silently erase in-flight state.
 */
function reconcileChat(existing: Chat, incoming: Chat): Chat {
  const incomingIds = new Set(incoming.messages.map((m) => m.id));
  const localOnlyMessages = existing.messages.filter(
    (m) => !incomingIds.has(m.id),
  );

  return {
    ...existing,
    ...incoming,
    messages: [...incoming.messages, ...localOnlyMessages],
  };
}

// ─── Chat Slice ───────────────────────────────────────────────────────────────

interface ChatSlice {
  chats: Chat[];
  activeChatId: string | null;
  isStreaming: boolean;
  streamingMessageId: string | null;
  error: string | null;

  // Actions
  setActiveChat: (chatId: string) => void;
  addChat: (chat: Chat) => void;
  setChats: (chats: Chat[]) => void;
  renameChat: (chatId: string, title: string) => void;
  removeChat: (chatId: string) => void;
  addMessage: (chatId: string, message: ChatMessage) => void;
  updateStreamingMessage: (chatId: string, messageId: string, delta: string) => void;
  finalizeStreamingMessage: (chatId: string, messageId: string, products?: Product[]) => void;
  appendProductsToMessage: (chatId: string, messageId: string, products: Product[]) => void;
  setMessageCheckoutInfo: (chatId: string, messageId: string, checkoutInfo: CheckoutInfo) => void;
  setStreaming: (isStreaming: boolean, messageId?: string) => void;
  setError: (error: string | null) => void;
  clearChats: () => void;
  setMessageFeedback: (chatId: string, messageId: string, feedback: 'like' | 'dislike' | null) => void;
  setMessageContent: (chatId: string, messageId: string, content: string) => void;
  setChatPinned: (chatId: string, isPinned: boolean) => void;
}

const createChatSlice = (
  set: (fn: (state: KaprukStore) => void) => void,
): ChatSlice => ({
  chats: [],
  activeChatId: null,
  isStreaming: false,
  streamingMessageId: null,
  error: null,

  setActiveChat: (chatId) =>
    set((state) => {
      state.activeChatId = chatId;
    }),

  // Upsert, not append: every call site (chat creation, the [id] page's
  // load-on-mount fetch, StrictMode's double effect invocation, revisiting a
  // chat already in the list) can hand back a chat whose id is already in
  // `chats`. Reconciling by id here — instead of relying on callers to check
  // first — is what keeps `chats` id-unique regardless of how many times or
  // where this is called from.
  addChat: (chat) =>
    set((state) => {
      const index = state.chats.findIndex((c) => c.id === chat.id);
      if (index === -1) {
        state.chats.unshift(chat);
      } else {
        state.chats[index] = reconcileChat(state.chats[index], chat);
      }
      state.activeChatId = chat.id;
    }),

  setChats: (chats) =>
    set((state) => {
      // Hydrating the sidebar list (GET /chats) must not clobber a chat
      // that's already loaded with full message history — the list endpoint
      // returns chat summaries without messages.
      const existingById = new Map(state.chats.map((c) => [c.id, c]));
      const merged = chats.map((incoming) => {
        const existing = existingById.get(incoming.id);
        return existing ? reconcileChat(existing, incoming) : incoming;
      });

      const seen = new Set(merged.map((c) => c.id));
      const localOnly = state.chats.filter((c) => !seen.has(c.id));

      state.chats = [...merged, ...localOnly];
    }),

  renameChat: (chatId, title) =>
    set((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      if (chat) chat.title = title;
    }),

  removeChat: (chatId) =>
    set((state) => {
      state.chats = state.chats.filter((c) => c.id !== chatId);
      if (state.activeChatId === chatId) state.activeChatId = null;
    }),

  addMessage: (chatId, message) =>
    set((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      if (chat) chat.messages.push(message);
    }),

  updateStreamingMessage: (chatId, messageId, delta) =>
    set((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      const msg = chat?.messages.find((m) => m.id === messageId);
      if (msg) msg.content += delta;
    }),

  finalizeStreamingMessage: (chatId, messageId, products) =>
    set((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      const msg = chat?.messages.find((m) => m.id === messageId);
      if (msg) {
        msg.isStreaming = false;
        if (products && products.length > 0) {
          msg.responseType = 'product_list';
          msg.products = products;
        }
      }
      state.isStreaming = false;
      state.streamingMessageId = null;
    }),

  appendProductsToMessage: (chatId, messageId, products) =>
    set((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      const msg = chat?.messages.find((m) => m.id === messageId);
      if (msg) {
        msg.products = [...(msg.products ?? []), ...products];
        msg.responseType = 'product_list';
      }
    }),

  setMessageCheckoutInfo: (chatId, messageId, checkoutInfo) =>
    set((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      const msg = chat?.messages.find((m) => m.id === messageId);
      if (msg) msg.checkoutInfo = checkoutInfo;
    }),

  setStreaming: (isStreaming, messageId) =>
    set((state) => {
      state.isStreaming = isStreaming;
      state.streamingMessageId = messageId ?? null;
    }),

  setError: (error) =>
    set((state) => {
      state.error = error;
    }),

  clearChats: () =>
    set((state) => {
      state.chats = [];
      state.activeChatId = null;
    }),

  setMessageFeedback: (chatId, messageId, feedback) =>
    set((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      const msg = chat?.messages.find((m) => m.id === messageId);
      if (msg) msg.feedback = msg.feedback === feedback ? null : feedback;
    }),

  setMessageContent: (chatId, messageId, content) =>
    set((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      const msg = chat?.messages.find((m) => m.id === messageId);
      if (msg) msg.content = content;
    }),

  setChatPinned: (chatId, isPinned) =>
    set((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      if (chat) chat.isPinned = isPinned;
    }),
});

// ─── Cart Slice ───────────────────────────────────────────────────────────────

interface CartSlice {
  items: CartItem[];
  isDrawerOpen: boolean;
  isCheckingOut: boolean;

  // Actions
  addItem: (item: Omit<CartItem, 'id'>) => void;
  removeItem: (kaprukaProdId: string) => void;
  updateQuantity: (kaprukaProdId: string, quantity: number) => void;
  setGiftMessage: (kaprukaProdId: string, giftMessage: GiftMessageInput | undefined) => void;
  clearCart: () => void;
  toggleDrawer: (open?: boolean) => void;
  setCheckingOut: (value: boolean) => void;

  // Computed (derived)
  getTotalItems: () => number;
  getTotalAmount: () => number;
}

const createCartSlice = (
  set: (fn: (state: KaprukStore) => void) => void,
  get: () => KaprukStore,
): CartSlice => ({
  items: [],
  isDrawerOpen: false,
  isCheckingOut: false,

  addItem: (item) =>
    set((state) => {
      const existing = state.items.find((i) => i.kaprukaProdId === item.kaprukaProdId);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        state.items.push({ ...item, id: crypto.randomUUID() });
      }
      state.isDrawerOpen = true; // Auto-open drawer on add
    }),

  removeItem: (kaprukaProdId) =>
    set((state) => {
      state.items = state.items.filter((i) => i.kaprukaProdId !== kaprukaProdId);
    }),

  updateQuantity: (kaprukaProdId, quantity) =>
    set((state) => {
      const item = state.items.find((i) => i.kaprukaProdId === kaprukaProdId);
      if (item) {
        if (quantity <= 0) {
          state.items = state.items.filter((i) => i.kaprukaProdId !== kaprukaProdId);
        } else {
          item.quantity = quantity;
        }
      }
    }),

  setGiftMessage: (kaprukaProdId, giftMessage) =>
    set((state) => {
      const item = state.items.find((i) => i.kaprukaProdId === kaprukaProdId);
      if (item) item.giftMessage = giftMessage;
    }),

  clearCart: () =>
    set((state) => {
      state.items = [];
    }),

  toggleDrawer: (open) =>
    set((state) => {
      state.isDrawerOpen = open ?? !state.isDrawerOpen;
    }),

  setCheckingOut: (value) =>
    set((state) => {
      state.isCheckingOut = value;
    }),

  getTotalItems: () =>
    get().items.reduce((sum, item) => sum + item.quantity, 0),

  getTotalAmount: () =>
    get().items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
});

// ─── Wishlist Slice ─────────────────────────────────────────────────────────────
// Real, persisted (localStorage) feature — a set of product IDs the shopper
// saved. Never backed by fabricated data; it only ever stores what the user
// themselves chose to save.

interface WishlistSlice {
  wishlist: string[];
  toggleWishlist: (productId: string) => void;
  isWishlisted: (productId: string) => boolean;
}

const createWishlistSlice = (
  set: (fn: (state: KaprukStore) => void) => void,
  get: () => KaprukStore,
): WishlistSlice => ({
  wishlist: [],

  toggleWishlist: (productId) =>
    set((state) => {
      const index = state.wishlist.indexOf(productId);
      if (index === -1) {
        state.wishlist.push(productId);
      } else {
        state.wishlist.splice(index, 1);
      }
    }),

  isWishlisted: (productId) => get().wishlist.includes(productId),
});

// ─── UI Slice ─────────────────────────────────────────────────────────────────

interface UISlice {
  language: Language;
  theme: 'light' | 'dark' | 'system';
  isVoiceMode: boolean;
  isRecording: boolean;
  isMobileSidebarOpen: boolean;

  setLanguage: (language: Language) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleVoiceMode: () => void;
  setRecording: (value: boolean) => void;
  toggleMobileSidebar: (open?: boolean) => void;
}

const createUISlice = (
  set: (fn: (state: KaprukStore) => void) => void,
): UISlice => ({
  language: 'EN',
  theme: 'system',
  isVoiceMode: false,
  isRecording: false,
  isMobileSidebarOpen: false,

  setLanguage: (language) =>
    set((state) => {
      state.language = language;
    }),

  setTheme: (theme) =>
    set((state) => {
      state.theme = theme;
    }),

  toggleVoiceMode: () =>
    set((state) => {
      state.isVoiceMode = !state.isVoiceMode;
    }),

  setRecording: (value) =>
    set((state) => {
      state.isRecording = value;
    }),

  toggleMobileSidebar: (open) =>
    set((state) => {
      state.isMobileSidebarOpen = open ?? !state.isMobileSidebarOpen;
    }),
});

// ─── Combined Store ───────────────────────────────────────────────────────────

type KaprukStore = ChatSlice & CartSlice & WishlistSlice & UISlice;

export const useKaprukStore = create<KaprukStore>()(
  persist(
    immer((set, get) => ({
      ...createChatSlice(set),
      ...createCartSlice(set, get),
      ...createWishlistSlice(set, get),
      ...createUISlice(set),
    })),
    {
      name: 'kapruka-store',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : ({} as Storage),
      ),
      // Only persist cart, wishlist, and UI preferences — chat is fetched from API
      partialize: (state) => ({
        items: state.items,
        wishlist: state.wishlist,
        language: state.language,
        theme: state.theme,
      }),
    },
  ),
);

// ─── Selector hooks (memoized to prevent unnecessary re-renders) ──────────────

export const useActiveChat = () =>
  useKaprukStore((s) =>
    s.chats.find((c) => c.id === s.activeChatId) ?? null,
  );

export const useCartCount = () =>
  useKaprukStore((s) => s.items.reduce((n, i) => n + i.quantity, 0));

export const useCartTotal = () =>
  useKaprukStore((s) =>
    s.items.reduce((n, i) => n + i.unitPrice * i.quantity, 0),
  );

export const useIsStreaming = () =>
  useKaprukStore((s) => s.isStreaming);

export const useLanguage = () =>
  useKaprukStore((s) => s.language);