'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chat, useKaprukStore, useLanguage } from '@/stores/kapruk.store';
import { apiClient } from '@/lib/api-client';
import { getFriendlyErrorMessage } from '@/lib/errors';
import { useRouter } from 'next/navigation';

function groupChatsByDate(chats: Chat[]): { label: string; chats: Chat[] }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const pinned = chats.filter((c) => c.isPinned);
  const rest = chats.filter((c) => !c.isPinned);

  const groups = new Map<string, Chat[]>();
  for (const chat of rest) {
    const created = new Date(chat.createdAt);
    created.setHours(0, 0, 0, 0);
    const label =
      created.getTime() === today.getTime()
        ? 'Today'
        : created.getTime() === yesterday.getTime()
          ? 'Yesterday'
          : 'Older';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(chat);
  }

  const ordered: { label: string; chats: Chat[] }[] = [];
  if (pinned.length > 0) ordered.push({ label: 'Pinned', chats: pinned });
  for (const label of ['Today', 'Yesterday', 'Older']) {
    const group = groups.get(label);
    if (group && group.length > 0) ordered.push({ label, chats: group });
  }
  return ordered;
}

export function ChatSidebar() {
  const {
    chats,
    activeChatId,
    addChat,
    setChats,
    renameChat,
    removeChat,
    setChatPinned,
    setLanguage,
    setError,
    isMobileSidebarOpen,
    toggleMobileSidebar,
  } = useKaprukStore();
  const language = useLanguage();
  const router = useRouter();

  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuChatId, setOpenMenuChatId] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [busyChatId, setBusyChatId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedChats, setArchivedChats] = useState<Chat[]>([]);
  const [isLoadingArchived, setIsLoadingArchived] = useState(false);

  const editInputRef = useRef<HTMLInputElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const hasFetchedListRef = useRef(false);

  useEffect(() => {
    if (hasFetchedListRef.current) return;
    hasFetchedListRef.current = true;

    apiClient
      .get<Chat[]>('/chats')
      .then((serverChats) => {
        setChats(serverChats.map((c) => ({ ...c, messages: c.messages ?? [] })));
      })
      .catch((error) => {
        hasFetchedListRef.current = false;
        console.error('Failed to load chat list:', error);
      })
      .finally(() => setIsLoadingList(false));
  }, [setChats]);

  // Close the open context menu on outside click or Escape.
  useEffect(() => {
    if (!openMenuChatId) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (!menuContainerRef.current?.contains(e.target as Node)) {
        setOpenMenuChatId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuChatId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuChatId]);

  useEffect(() => {
    if (editingChatId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingChatId]);

  // Keyboard shortcut: Cmd/Ctrl+K focuses chat search.
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  const filteredChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => (c.title ?? 'New chat').toLowerCase().includes(q));
  }, [chats, searchQuery]);

  const groupedChats = useMemo(() => groupChatsByDate(filteredChats), [filteredChats]);

  const goToChat = (chatId: string) => {
    router.push(`/chat/${chatId}`);
    toggleMobileSidebar(false);
  };

  const handleNewChat = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const chat = await apiClient.post<Chat>('/chats', {});
      addChat({ ...chat, messages: chat.messages ?? [] });
      router.push(`/chat/${chat.id}`);
      toggleMobileSidebar(false);
    } catch (error) {
      console.error('Failed to create chat:', error);
      setError(getFriendlyErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  const startRename = (chat: Chat) => {
    setEditingChatId(chat.id);
    setEditValue(chat.title ?? '');
    setOpenMenuChatId(null);
  };

  const cancelRename = () => setEditingChatId(null);

  const commitRename = async (chatId: string) => {
    const title = editValue.trim();
    setEditingChatId(null);
    if (!title) return;

    const previousTitle = chats.find((c) => c.id === chatId)?.title;
    if (title === previousTitle) return;

    renameChat(chatId, title);
    setBusyChatId(chatId);
    try {
      await apiClient.patch(`/chats/${chatId}`, { title });
    } catch (error) {
      console.error('Failed to rename chat:', error);
      renameChat(chatId, previousTitle ?? 'New chat');
      setError(getFriendlyErrorMessage(error));
    } finally {
      setBusyChatId(null);
    }
  };

  const requestDelete = (chatId: string) => {
    setPendingDeleteChatId(chatId);
    setOpenMenuChatId(null);
  };

  const confirmDelete = async () => {
    const chatId = pendingDeleteChatId;
    if (!chatId) return;
    setPendingDeleteChatId(null);
    setBusyChatId(chatId);

    const wasActive = activeChatId === chatId;
    const nextChat = chats.find((c) => c.id !== chatId);

    try {
      await apiClient.delete(`/chats/${chatId}`);
      removeChat(chatId);
      if (wasActive) {
        router.push(nextChat ? `/chat/${nextChat.id}` : '/chat');
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
      setError(getFriendlyErrorMessage(error));
    } finally {
      setBusyChatId(null);
    }
  };

  const handleDuplicate = async (chat: Chat) => {
    setOpenMenuChatId(null);
    setBusyChatId(chat.id);
    try {
      const copy = await apiClient.post<Chat>(`/chats/${chat.id}/duplicate`, {});
      addChat({ ...copy, messages: copy.messages ?? [] });
      router.push(`/chat/${copy.id}`);
      toggleMobileSidebar(false);
    } catch (error) {
      console.error('Failed to duplicate chat:', error);
      setError(getFriendlyErrorMessage(error));
    } finally {
      setBusyChatId(null);
    }
  };

  const handleArchive = async (chat: Chat) => {
    setOpenMenuChatId(null);
    setBusyChatId(chat.id);
    const wasActive = activeChatId === chat.id;
    const nextChat = chats.find((c) => c.id !== chat.id);

    try {
      await apiClient.post(`/chats/${chat.id}/archive`, {});
      removeChat(chat.id);
      if (wasActive) {
        router.push(nextChat ? `/chat/${nextChat.id}` : '/chat');
      }
    } catch (error) {
      console.error('Failed to archive chat:', error);
      setError(getFriendlyErrorMessage(error));
    } finally {
      setBusyChatId(null);
    }
  };

  const handleTogglePin = async (chat: Chat) => {
    setOpenMenuChatId(null);
    const nextPinned = !chat.isPinned;
    setChatPinned(chat.id, nextPinned); // optimistic
    try {
      await apiClient.patch(`/chats/${chat.id}/pin`, { isPinned: nextPinned });
    } catch (error) {
      console.error('Failed to pin chat:', error);
      setChatPinned(chat.id, !nextPinned);
      setError(getFriendlyErrorMessage(error));
    }
  };

  const loadArchived = async () => {
    const next = !showArchived;
    setShowArchived(next);
    if (next && archivedChats.length === 0) {
      setIsLoadingArchived(true);
      try {
        const list = await apiClient.get<Chat[]>('/chats?archived=true');
        setArchivedChats(list);
      } catch (error) {
        console.error('Failed to load archived chats:', error);
      } finally {
        setIsLoadingArchived(false);
      }
    }
  };

  const handleUnarchive = async (chat: Chat) => {
    setBusyChatId(chat.id);
    try {
      const restored = await apiClient.post<Chat>(`/chats/${chat.id}/unarchive`, {});
      setArchivedChats((prev) => prev.filter((c) => c.id !== chat.id));
      addChat({ ...restored, messages: restored.messages ?? [] });
    } catch (error) {
      console.error('Failed to restore chat:', error);
      setError(getFriendlyErrorMessage(error));
    } finally {
      setBusyChatId(null);
    }
  };

  const renderChatRow = (chat: Chat) => {
    const isActive = chat.id === activeChatId;
    const isEditing = editingChatId === chat.id;
    const isMenuOpen = openMenuChatId === chat.id;
    const isBusy = busyChatId === chat.id;

    return (
      <div
        key={chat.id}
        className={`k-chat-row${isMenuOpen ? ' k-chat-row-menu-open' : ''}`}
        style={{
          borderRadius: 9, marginBottom: 2,
          background: isActive ? 'var(--k-color-accent-muted)' : 'transparent',
          borderLeft: isActive ? '3px solid var(--k-color-accent)' : '3px solid transparent',
          opacity: isBusy ? 0.5 : 1,
        }}
      >
        {isEditing ? (
          <input
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitRename(chat.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename(chat.id);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            maxLength={80}
            aria-label="Chat title"
            className="k-input"
            style={{ flex: 1, padding: '7px 9px', fontSize: 13, height: 'auto' }}
          />
        ) : (
          <button
            onClick={() => goToChat(chat.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename(chat);
            }}
            disabled={isBusy}
            title={chat.title ?? 'New chat'}
            style={{
              flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none',
              padding: '9px 10px', cursor: isBusy ? 'default' : 'pointer',
              fontSize: 13, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5,
              color: isActive ? 'var(--k-color-text)' : 'var(--k-color-text-2)',
              fontWeight: isActive ? 500 : 400,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              transition: 'color var(--k-transition-base)',
            }}
          >
            {chat.isPinned && <span style={{ fontSize: 10, flexShrink: 0 }}>📌</span>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chat.title ?? 'New chat'}</span>
          </button>
        )}

        {!isEditing && (
          <div style={{ position: 'relative' }}>
            <button
              className="k-chat-row-menu-btn k-btn k-btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuChatId(isMenuOpen ? null : chat.id);
              }}
              disabled={isBusy}
              aria-label={`More options for ${chat.title ?? 'this chat'}`}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              style={{ padding: '4px 6px', fontSize: 14, marginRight: 4 }}
            >
              ⋮
            </button>

            {isMenuOpen && (
              <div className="k-context-menu" role="menu">
                <button role="menuitem" className="k-context-menu-item" onClick={() => startRename(chat)}>
                  ✏️ Rename
                </button>
                <button role="menuitem" className="k-context-menu-item" onClick={() => handleTogglePin(chat)}>
                  📌 {chat.isPinned ? 'Unpin' : 'Pin'}
                </button>
                <button role="menuitem" className="k-context-menu-item" onClick={() => handleDuplicate(chat)}>
                  ⧉ Duplicate
                </button>
                <button role="menuitem" className="k-context-menu-item" onClick={() => handleArchive(chat)}>
                  🗄️ Archive
                </button>
                <button role="menuitem" className="k-context-menu-item k-danger" onClick={() => requestDelete(chat.id)}>
                  🗑️ Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {isMobileSidebarOpen && (
        <div className="k-sidebar-backdrop" onClick={() => toggleMobileSidebar(false)} aria-hidden="true" />
      )}

      <aside
        className={`k-sidebar${isMobileSidebarOpen ? ' k-sidebar-open' : ''}`}
        style={{
          width: 240, background: 'var(--k-color-surface)',
          borderRight: '1px solid var(--k-color-border)',
          display: 'flex', flexDirection: 'column', flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div style={{ padding: '20px 16px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9,
            background: 'linear-gradient(135deg,var(--k-color-accent),var(--k-color-accent-dark))',
            display: 'grid', placeItems: 'center', color: '#fff', fontSize: 15, fontWeight: 700,
          }}>K</div>
          <span style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--k-font-serif)' }}>Kapruka AI</span>
          <button
            onClick={() => toggleMobileSidebar(false)}
            aria-label="Close sidebar"
            className="k-btn k-btn-ghost k-sidebar-close-btn"
            style={{ marginLeft: 'auto', padding: 4, fontSize: 16 }}
          >
            ✕
          </button>
        </div>

        {/* New Chat */}
        <button onClick={handleNewChat} disabled={isCreating} className="k-btn k-btn-primary" style={{ margin: '0 12px 10px', fontSize: 13 }}>
          {isCreating ? 'Starting…' : '+ New chat'}
        </button>

        {/* Search */}
        <div style={{ padding: '0 12px 10px' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--k-color-text-3)' }}>🔍</span>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
              placeholder="Search chats… (⌘K)"
              className="k-input"
              style={{ paddingLeft: 28, fontSize: 12.5, height: 32 }}
              aria-label="Search chats"
            />
          </div>
        </div>

        {/* Chat list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }} ref={menuContainerRef}>
          {isLoadingList && chats.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 2px' }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="k-skeleton" style={{ height: 32, borderRadius: 9 }} />
              ))}
            </div>
          )}

          {!isLoadingList && filteredChats.length === 0 && searchQuery && (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--k-color-text-3)', fontSize: 12.5 }}>
              No chats match &ldquo;{searchQuery}&rdquo;
            </div>
          )}

          {!isLoadingList && chats.length === 0 && !searchQuery && (
            <div style={{
              padding: '32px 12px', textAlign: 'center', color: 'var(--k-color-text-3)',
              fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
            }}>
              <span style={{ fontSize: 24 }}>💬</span>
              <span>No conversations yet</span>
              <span style={{ fontSize: 12 }}>Start a new chat to begin shopping</span>
            </div>
          )}

          {groupedChats.map((group) => (
            <div key={group.label} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--k-color-text-3)', padding: '6px 10px 4px' }}>
                {group.label}
              </div>
              {group.chats.map(renderChatRow)}
            </div>
          ))}

          {/* Archived section */}
          <div style={{ marginTop: 8, borderTop: '1px solid var(--k-color-border)', paddingTop: 8 }}>
            <button
              onClick={loadArchived}
              className="k-btn k-btn-ghost"
              style={{ width: '100%', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--k-color-text-3)' }}
            >
              <span>🗄️ Archived</span>
              <span>{showArchived ? '▲' : '▼'}</span>
            </button>
            {showArchived && (
              <div style={{ marginTop: 4 }}>
                {isLoadingArchived && <div className="k-skeleton" style={{ height: 28, borderRadius: 9, margin: '2px 0' }} />}
                {!isLoadingArchived && archivedChats.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--k-color-text-3)', padding: '6px 10px' }}>No archived chats</div>
                )}
                {archivedChats.map((chat) => (
                  <div key={chat.id} className="k-chat-row" style={{ borderRadius: 9, opacity: busyChatId === chat.id ? 0.5 : 1 }}>
                    <span style={{ flex: 1, padding: '8px 10px', fontSize: 12.5, color: 'var(--k-color-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {chat.title ?? 'New chat'}
                    </span>
                    <button
                      onClick={() => handleUnarchive(chat)}
                      disabled={busyChatId === chat.id}
                      className="k-btn k-btn-ghost k-chat-row-menu-btn"
                      style={{ fontSize: 11, padding: '4px 8px', opacity: 1 }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Language switcher */}
        <div style={{ padding: 12, borderTop: '1px solid var(--k-color-border)' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['EN', 'SI', 'SINGLISH'] as const).map(lang => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  border: `1px solid ${language === lang ? 'var(--k-color-accent)' : 'var(--k-color-border-2)'}`,
                  background: language === lang ? 'var(--k-color-accent)' : 'transparent',
                  color: language === lang ? '#fff' : 'var(--k-color-text-2)',
                  transition: 'all var(--k-transition-base)',
                }}
              >
                {lang === 'SINGLISH' ? 'SL' : lang === 'SI' ? 'සිං' : lang}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {pendingDeleteChatId && (
        <div className="k-confirm-backdrop" onClick={() => setPendingDeleteChatId(null)}>
          <div
            className="k-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-chat-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-chat-title" style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>
              Delete this chat?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--k-color-text-2)', marginBottom: 20 }}>
              This will permanently remove the conversation. This can&apos;t be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="k-btn k-btn-secondary" style={{ fontSize: 13 }} onClick={() => setPendingDeleteChatId(null)}>
                Cancel
              </button>
              <button
                className="k-btn"
                style={{ fontSize: 13, background: 'var(--k-color-danger)', color: '#fff', borderColor: 'var(--k-color-danger)' }}
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
