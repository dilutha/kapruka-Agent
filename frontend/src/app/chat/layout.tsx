'use client';
import { ChatSidebar } from './ChatSidebar';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { useKaprukStore } from '@/stores/kapruk.store';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const isDrawerOpen = useKaprukStore(s => s.isDrawerOpen);
  const toggleMobileSidebar = useKaprukStore(s => s.toggleMobileSidebar);

  return (
    <div style={{
      display: 'flex', height: '100dvh', overflow: 'hidden',
      background: 'var(--k-color-bg)', color: 'var(--k-color-text)',
      fontFamily: 'var(--k-font-sans)',
    }}>
      <button
        onClick={() => toggleMobileSidebar()}
        aria-label="Open sidebar"
        className="k-btn k-btn-ghost k-mobile-menu-btn"
      >
        ☰
      </button>
      <ChatSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {children}
      </main>
      {isDrawerOpen && <CartDrawer />}
    </div>
  );
}
