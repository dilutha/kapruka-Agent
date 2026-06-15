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
  currency: string;
  imageUrls: string[];
  category: string;
  isAvailable: boolean;
  description?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  responseType?: ResponseType;
  products?: Product[];        // Populated for product_list type
  cartSnapshot?: CartItem[];   // Populated for cart type
  isStreaming?: boolean;       // True while SSE chunks are arriving
  createdAt: Date;
}

export interface Chat {
  id: string;
  title?: string;
  detectedLanguage: Language;
  messages: ChatMessage[];
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
  addMessage: (chatId: string, message: ChatMessage) => void;
  updateStreamingMessage: (chatId: string, messageId: string, delta: string) => void;
  finalizeStreamingMessage: (chatId: string, messageId: string, products?: Product[]) => void;
  appendProductsToMessage: (chatId: string, messageId: string, products: Product[]) => void;
  setStreaming: (isStreaming: boolean, messageId?: string) => void;
  setError: (error: string | null) => void;
  clearChats: () => void;
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

  addChat: (chat) =>
    set((state) => {
      state.chats.unshift(chat);
      state.activeChatId = chat.id;
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
  toggleMobileSidebar: () => void;
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

  toggleMobileSidebar: () =>
    set((state) => {
      state.isMobileSidebarOpen = !state.isMobileSidebarOpen;
    }),
});

// ─── Combined Store ───────────────────────────────────────────────────────────

type KaprukStore = ChatSlice & CartSlice & UISlice;

export const useKaprukStore = create<KaprukStore>()(
  persist(
    immer((set, get) => ({
      ...createChatSlice(set),
      ...createCartSlice(set, get),
      ...createUISlice(set),
    })),
    {
      name: 'kapruka-store',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : ({} as Storage),
      ),
      // Only persist cart and UI preferences — chat is fetched from API
      partialize: (state) => ({
        items: state.items,
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