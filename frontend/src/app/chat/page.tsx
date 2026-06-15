'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Chat, useKaprukStore } from '@/stores/kapruk.store';

export default function NewChatPage() {
  const router = useRouter();
  const addChat = useKaprukStore((state) => state.addChat);
  const setError = useKaprukStore((state) => state.setError);

  useEffect(() => {
    let active = true;

    apiClient
      .post<Chat>('/chats', {})
      .then((chat) => {
        if (!active) return;
        addChat({ ...chat, messages: chat.messages ?? [] });
        router.replace(`/chat/${chat.id}`);
      })
      .catch(() => {
        if (active) setError('Unable to start a chat. Please try again.');
      });

    return () => {
      active = false;
    };
  }, [addChat, router, setError]);

  return (
    <div style={{ display: 'grid', flex: 1, placeItems: 'center' }}>
      Starting your shopping assistant...
    </div>
  );
}
