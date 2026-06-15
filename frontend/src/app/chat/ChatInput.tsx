'use client';
import { useRef, useCallback, KeyboardEvent, useState } from 'react';
import { useVoice } from '@/hooks/useVoice';
import { useKaprukStore } from '@/stores/kapruk.store';

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const language = useKaprukStore(s => s.language);
  const { state: voiceState, transcript, startListening, stopListening } = useVoice();

  const placeholder = {
    EN: 'Message Kaprubot…',
    SI: 'Kaprubot ට ලියන්න…',
    SINGLISH: 'Machan, type here…',
  }[language];

  const handleSend = useCallback(() => {
    const content = (text || transcript).trim();
    if (!content || disabled) return;
    onSend(content);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [onSend, disabled, text, transcript]);

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }
  };

  return (
    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--k-color-border)' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8,
        background: 'var(--k-color-surface)', borderRadius: 'var(--k-radius-input)',
        border: '1px solid var(--k-color-border-2)', padding: '10px 12px',
        transition: 'border-color var(--k-transition-base)',
      }}>
        <textarea
          ref={textareaRef}
          value={text || transcript}
          className="k-input"
          placeholder={voiceState === 'listening' ? 'Listening…' : placeholder}
          onKeyDown={handleKey}
          onChange={(event) => setText(event.target.value)}
          onInput={handleInput}
          disabled={disabled || voiceState === 'listening'}
          rows={1}
          style={{
            flex: 1, background: 'transparent', border: 'none', padding: 0,
            resize: 'none', outline: 'none', minHeight: 20, maxHeight: 100,
            fontSize: 14, lineHeight: 1.5, color: 'var(--k-color-text)',
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={voiceState === 'listening' ? stopListening : startListening}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              border: '1px solid var(--k-color-border-2)', background: 'transparent',
              cursor: 'pointer', display: 'grid', placeItems: 'center', fontSize: 16,
              color: voiceState === 'listening' ? 'var(--k-color-danger)' : 'var(--k-color-text-2)',
            }}
          >
            {voiceState === 'listening' ? '⏹' : '🎙'}
          </button>
          <button
            onClick={handleSend}
            disabled={disabled}
            style={{
              width: 32, height: 32, borderRadius: '50%', border: 'none',
              background: disabled ? 'var(--k-color-surface-3)' : 'var(--k-color-accent)',
              cursor: disabled ? 'default' : 'pointer',
              display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14,
              transition: 'all var(--k-transition-base)',
            }}
          >➤</button>
        </div>
      </div>
    </div>
  );
}
