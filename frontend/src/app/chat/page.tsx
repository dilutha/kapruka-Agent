'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Chat, useKaprukStore } from '@/stores/kapruk.store';

export default function NewChatPage() {
  const router = useRouter();
  const addChat = useKaprukStore((state) => state.addChat);
  const setError = useKaprukStore((state) => state.setError);

  // React Strict Mode intentionally mounts -> cleans up -> remounts every
  // effect in development. A local `let active = true` inside the effect body
  // only guards the *response handler* of each invocation — it can't stop the
  // POST itself from going out twice, since each invocation gets its own fresh
  // closure. A ref survives across that synthetic remount (only the effect
  // re-runs, not the component instance), so checking-and-setting it
  // synchronously, before the request starts, is what actually prevents the
  // second POST /chats from ever being sent — this is what created a real,
  // orphaned duplicate chat row on every visit to this page.
  const hasRequestedRef = useRef(false);

  useEffect(() => {
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    apiClient
      .post<Chat>('/chats', {})
      .then((chat) => {
        addChat({ ...chat, messages: chat.messages ?? [] });
        router.replace(`/chat/${chat.id}`);
      })
      .catch(() => {
        hasRequestedRef.current = false; // allow retry on genuine failure
        setError('Unable to start a chat. Please try again.');
      });
  }, [addChat, router, setError]);

  return (
    <div style={{ display: 'grid', flex: 1, placeItems: 'center' }}>
      Starting your shopping assistant...
    </div>
  );
}
