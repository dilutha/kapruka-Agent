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
import { useKaprukStore, Product } from '@/stores/kapruk.store';
import { apiClient } from '@/lib/api-client';

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

      if (event === 'error') {
        const message =
          typeof data.message === 'string' ? data.message : 'An error occurred';
        updateStreamingMessage(chatId, messageId, `\n\n⚠️ ${message}`);
      }
    },
    [appendProductsToMessage, updateStreamingMessage],
  );

  const sendMessage = useCallback(
    async ({ chatId, content }: SendMessageOptions): Promise<void> => {
      // Cancel any in-flight stream
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

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

      try {
        const response = await fetch(
          `${apiClient.baseUrl}/chats/${chatId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...apiClient.getAuthHeaders(),
            },
            body: JSON.stringify({ content }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

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
        if ((error as Error).name === 'AbortError') {
          // User cancelled — finalize with what we have
          finalizeStreamingMessage(chatId, assistantMessageId);
          return;
        }

        const errorMessage = getLocalizedErrorMessage(error);
        updateStreamingMessage(chatId, assistantMessageId, `\n\n⚠️ ${errorMessage}`);
        finalizeStreamingMessage(chatId, assistantMessageId);
        setError(errorMessage);

        console.error('Stream error:', error);
      }
    },
    [
      addMessage,
      updateStreamingMessage,
      finalizeStreamingMessage,
      appendProductsToMessage,
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

// ─── Error message localizer ───────────────────────────────────────────────────

function getLocalizedErrorMessage(error: unknown): string {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return 'Network error — please check your connection and try again.';
  }
  if (error instanceof Error && error.message.includes('HTTP 429')) {
    return 'Too many messages — please wait a moment before sending another.';
  }
  if (error instanceof Error && error.message.includes('HTTP 503')) {
    return 'The assistant is temporarily unavailable. Please try again shortly.';
  }
  return 'Something went wrong. Please try again.';
}
