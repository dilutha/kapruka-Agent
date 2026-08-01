/**
 * useChatStream
 *
 * Custom hook that manages the full lifecycle of a streaming chat message:
 *  1. POST message to backend → receive SSE stream
 *  2. Parse SSE events (text_delta, tool_call, tool_result, done, error)
 *  3. Update Zustand store incrementally as tokens arrive
 *  4. Handle reconnection on network drops
 *  5. Track analytics events
 *
 * Uses fetch + ReadableStream (not EventSource) because EventSource
 * doesn't support POST requests or custom headers.
 */

'use client';

import { useCallback, useRef } from 'react';
import { useKaprukStore, Product, CheckoutInfo } from '@/stores/kapruk.store';
import { apiClient } from '@/lib/api-client';
import {
  getFriendlyErrorMessage,
  getFriendlySseErrorMessage,
  isAbortError,
} from '@/lib/errors';

// Overall ceiling for a single message's request+stream lifetime. Guards
// against a stalled connection that never errors and never sends another
// byte (a dead proxy, a silently dropped connection) — without this, such a
// stall would leave the UI stuck on "streaming" forever.
const STREAM_TIMEOUT_MS = 45_000;

interface SendMessageOptions {
  chatId: string;
  content: string;
}

interface UseStreamReturn {
  sendMessage: (options: SendMessageOptions) => Promise<void>;
  cancelStream: () => void;
  isStreaming: boolean;
}

export function useChatStream(): UseStreamReturn {
  const {
    addMessage,
    updateStreamingMessage,
    finalizeStreamingMessage,
    appendProductsToMessage,
    setMessageCheckoutInfo,
    setStreaming,
    setError,
  } = useKaprukStore();

  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreaming = useKaprukStore((s) => s.isStreaming);

  const cancelStream = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleSseEvent = useCallback(
    (
      event: string,
      dataStr: string,
      chatId: string,
      messageId: string,
      productAccumulator: Product[],
    ): void => {
      let data: Record<string, unknown>;

      try {
        data = JSON.parse(dataStr) as Record<string, unknown>;
      } catch {
        console.warn('Failed to parse SSE data:', dataStr);
        return;
      }

      if (event === 'text_delta' && typeof data.content === 'string') {
        updateStreamingMessage(chatId, messageId, data.content);
        return;
      }

      if (event === 'tool_result' && isRecord(data.result)) {
        const products = Array.isArray(data.result.products)
          ? data.result.products.filter(isProduct)
          : [];
        if (products.length > 0) {
          productAccumulator.push(...products);
          appendProductsToMessage(chatId, messageId, products);
        }
        return;
      }

      if (event === 'checkout_ready' && isCheckoutInfo(data)) {
        setMessageCheckoutInfo(chatId, messageId, data);
        return;
      }

      if (event === 'error') {
        const message = getFriendlySseErrorMessage(data.code, data.message);
        updateStreamingMessage(chatId, messageId, `\n\n⚠️ ${message}`);
      }
    },
    [appendProductsToMessage, setMessageCheckoutInfo, updateStreamingMessage],
  );

  const sendMessage = useCallback(
    async ({ chatId, content }: SendMessageOptions): Promise<void> => {
      // Cancel any in-flight stream
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Distinguishes "the user pressed cancel" (finalize silently, current
      // behavior) from "we gave up waiting" (finalize with a friendly
      // timeout message) — both surface as the same AbortError otherwise.
      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, STREAM_TIMEOUT_MS);

      // Optimistically add user message
      const userMessageId = crypto.randomUUID();
      addMessage(chatId, {
        id: userMessageId,
        role: 'user',
        content,
        createdAt: new Date(),
      });

      // Add placeholder assistant message (streaming state)
      const assistantMessageId = crypto.randomUUID();
      addMessage(chatId, {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        createdAt: new Date(),
      });

      setStreaming(true, assistantMessageId);
      setError(null);

      const accumulatedProducts: Product[] = [];

      // The cart lives only in the browser (Zustand/localStorage) — the
      // backend has no server-side cart of its own — so a fresh snapshot
      // rides along with every message. This is what lets checkout.node.ts
      // know what's actually in the cart instead of always seeing it empty.
      // Read via getState() (not a subscribed hook value) so this callback
      // doesn't need `items` in its dependency array just to see it once at
      // send time.
      const cartItems = useKaprukStore.getState().items.map((item) => ({
        kaprukaProdId: item.kaprukaProdId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      }));

      try {
        const response = await fetch(
          `${apiClient.baseUrl}/chats/${chatId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(await apiClient.getAuthHeaders()),
            },
            body: JSON.stringify({ content, cartItems }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        apiClient.captureGuestToken(response.headers);

        if (!response.body) {
          throw new Error('No response body');
        }

        // Read SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          // Keep last incomplete line in buffer
          buffer = lines.pop() ?? '';

          let currentEvent = '';
          let currentData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              currentData = line.slice(6).trim();
            } else if (line === '' && currentEvent && currentData) {
              // Dispatch complete SSE event
              handleSseEvent(
                currentEvent,
                currentData,
                chatId,
                assistantMessageId,
                accumulatedProducts,
              );
              currentEvent = '';
              currentData = '';
            }
          }
        }

        // Finalize message with any accumulated products
        finalizeStreamingMessage(
          chatId,
          assistantMessageId,
          accumulatedProducts.length > 0 ? accumulatedProducts : undefined,
        );
      } catch (error) {
        if (isAbortError(error)) {
          if (timedOut) {
            const timeoutMessage =
              'The request timed out. Please try again.';
            updateStreamingMessage(
              chatId,
              assistantMessageId,
              `\n\n⚠️ ${timeoutMessage}`,
            );
            finalizeStreamingMessage(chatId, assistantMessageId);
            setError(timeoutMessage);
          } else {
            // User cancelled — finalize silently with what we have.
            finalizeStreamingMessage(chatId, assistantMessageId);
          }
          return;
        }

        const errorMessage = getFriendlyErrorMessage(error);
        updateStreamingMessage(chatId, assistantMessageId, `\n\n⚠️ ${errorMessage}`);
        finalizeStreamingMessage(chatId, assistantMessageId);
        setError(errorMessage);

        console.error('Stream error:', error);
      } finally {
        clearTimeout(timeoutTimer);
      }
    },
    [
      addMessage,
      updateStreamingMessage,
      finalizeStreamingMessage,
      setStreaming,
      setError,
      handleSseEvent,
    ],
  );

  return { sendMessage, cancelStream, isStreaming };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProduct(value: unknown): value is Product {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.priceMin === 'number' &&
    typeof value.currency === 'string' &&
    Array.isArray(value.imageUrls) &&
    value.imageUrls.every((url) => typeof url === 'string') &&
    typeof value.category === 'string' &&
    typeof value.isAvailable === 'boolean'
  );
}

function isCheckoutInfo(value: unknown): value is CheckoutInfo {
  if (!isRecord(value)) return false;
  if (typeof value.orderRef !== 'string' || typeof value.checkoutUrl !== 'string') {
    return false;
  }
  const summary = value.summary;
  return (
    isRecord(summary) &&
    typeof summary.itemsTotal === 'number' &&
    typeof summary.deliveryFee === 'number' &&
    typeof summary.addonsTotal === 'number' &&
    typeof summary.grandTotal === 'number' &&
    typeof summary.currency === 'string'
  );
}
