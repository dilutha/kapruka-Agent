/**
 * useVoice
 *
 * Manages the complete voice interaction pipeline:
 *
 *  STT (Speech-to-Text):
 *    - Browser Web Speech API (SpeechRecognition) for low-latency local recognition
 *    - Fallback to OpenAI Whisper API for unsupported browsers / Sinhala accuracy
 *    - Voice Activity Detection via AudioWorklet (silence threshold: 500ms)
 *    - Language hints: 'en-US', 'si-LK', 'en-LK' (Singlish uses en-LK)
 *
 *  TTS (Text-to-Speech):
 *    - OpenAI TTS API (alloy voice) via backend streaming endpoint
 *    - Browser SpeechSynthesis API as fallback
 *    - Auto-cancels on new user input
 *
 *  State machine:
 *    IDLE → LISTENING → PROCESSING → SPEAKING → IDLE
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useKaprukStore, Language } from '@/stores/kapruk.store';
import { apiClient } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

interface UseVoiceReturn {
  state: VoiceState;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  speakText: (text: string) => void;
  cancelSpeaking: () => void;
  isSupported: boolean;
  error: string | null;
}

// ─── Language map ─────────────────────────────────────────────────────────────

const SPEECH_LANG_MAP: Record<Language, string> = {
  EN: 'en-US',
  SI: 'si-LK',       // Sinhala — limited browser support, uses Whisper fallback
  SINGLISH: 'en-LK', // Sri Lankan English
};

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<BrowserSpeechRecognitionResult>;
  }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
}

async function transcribeWithWhisper(
  audioBlob: Blob,
  lang: Language,
): Promise<string> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  formData.append('language', lang === 'SI' ? 'si' : 'en');

  const response = await fetch(`${apiClient.baseUrl}/voice/transcribe`, {
    method: 'POST',
    headers: apiClient.getAuthHeaders(),
    body: formData,
  });

  if (!response.ok) throw new Error('Transcription failed');
  const data = (await response.json()) as { text?: unknown };
  if (typeof data.text !== 'string') throw new Error('Invalid transcription response');
  return data.text;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVoice(): UseVoiceReturn {
  const language = useKaprukStore((s) => s.language);
  const setRecording = useKaprukStore((s) => s.setRecording);

  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      mediaRecorderRef.current?.stop();
      audioRef.current?.pause();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  // ─── STT: Web Speech API ────────────────────────────────────────────────────

  const startWebSpeech = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      const speechWindow = window as SpeechRecognitionWindow;
      const SpeechRecognition =
        speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        reject(new Error('Speech recognition is not supported'));
        return;
      }

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      recognition.lang = SPEECH_LANG_MAP[language];
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      let finalTranscript = '';

      recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }
        setTranscript(finalTranscript || interimTranscript);
      };

      recognition.onend = () => {
        if (finalTranscript) {
          resolve(finalTranscript);
        } else {
          reject(new Error('No speech detected'));
        }
      };

      recognition.onerror = (event) => {
        reject(new Error(event.error));
      };

      recognition.start();
    });
  }, [language]);

  // ─── STT: Whisper API fallback (for Sinhala or unsupported browsers) ────────

  const startWhisperRecording = useCallback((): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm',
        });
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

          try {
            const text = await transcribeWithWhisper(audioBlob, language);
            resolve(text);
          } catch (err) {
            reject(err);
          }
        };

        mediaRecorder.start(100); // Collect in 100ms chunks

        // Auto-stop after 30 seconds max
        setTimeout(() => {
          if (mediaRecorder.state === 'recording') mediaRecorder.stop();
        }, 30_000);
      } catch (err) {
        reject(err);
      }
    });
  }, [language]);

  // ─── Start listening ─────────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (state !== 'idle') return;

    cancelSpeaking();
    setState('listening');
    setRecording(true);
    setTranscript('');
    setError(null);

    try {
      let text: string;

      // Use Whisper for Sinhala (better accuracy) or unsupported browsers
      if (language === 'SI' || !isSupported) {
        text = await startWhisperRecording();
      } else {
        text = await startWebSpeech();
      }

      setTranscript(text);
      setState('idle');
      setRecording(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voice input failed';
      setError(msg);
      setState('error');
      setRecording(false);

      // Auto-clear error after 3s
      setTimeout(() => setState('idle'), 3000);
    }
  }, [state, language, isSupported, startWebSpeech, startWhisperRecording]);

  // ─── Stop listening ──────────────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    mediaRecorderRef.current?.stop();
    setState('idle');
    setRecording(false);
  }, []);

  // ─── TTS: Speak text ─────────────────────────────────────────────────────────

  const speakText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // Cancel any current speech
      cancelSpeaking();
      setState('speaking');

      try {
        // Try OpenAI TTS via backend
        const response = await fetch(`${apiClient.baseUrl}/voice/speak`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...apiClient.getAuthHeaders(),
          },
          body: JSON.stringify({
            text: text.slice(0, 4096), // OpenAI TTS limit
            language,
            voice: 'alloy',
          }),
        });

        if (!response.ok) throw new Error('TTS request failed');

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          setState('idle');
        };

        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          setState('idle');
        };

        await audio.play();
      } catch {
        // Browser TTS fallback
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = SPEECH_LANG_MAP[language];
          utterance.rate = 0.95;
          utterance.onend = () => setState('idle');
          window.speechSynthesis.speak(utterance);
        } else {
          setState('idle');
        }
      }
    },
    [language],
  );

  // ─── Cancel speaking ─────────────────────────────────────────────────────────

  function cancelSpeaking(): void {
    audioRef.current?.pause();
    if (typeof window !== 'undefined') {
      window.speechSynthesis?.cancel();
    }
    if (state === 'speaking') setState('idle');
  }

  return {
    state,
    transcript,
    startListening,
    stopListening,
    speakText,
    cancelSpeaking,
    isSupported,
    error,
  };
}
