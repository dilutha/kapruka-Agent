/**
 * Analytics Service (PostHog)
 * ============================
 * Tracks all meaningful user actions for:
 *  - Product discovery funnel (search → view → add_to_cart → purchase)
 *  - Language usage and switching patterns
 *  - AI agent effectiveness (intent accuracy, fallback rate)
 *  - Conversion funnel drop-off analysis
 *  - Voice usage rates
 *
 * PRIVACY:
 *  - No PII in event properties (names, emails, addresses are hashed/excluded)
 *  - User IDs are pseudonymous (internal UUIDs, not emails)
 *  - IP addresses are NOT sent to PostHog (configured server-side)
 *  - Guest users are tracked by session ID (expires in 72h)
 *
 * POSTHOG SETUP:
 *  - Server-side: Node.js SDK (this file)
 *  - Client-side: Next.js provider wrapping app for session recording
 *  - Feature flags used for A/B testing UI variants
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';

// ─── Event catalogue ──────────────────────────────────────────────────────────
// All event names are defined here to prevent typos and enable autocomplete

export type AnalyticsEventName =
  // Chat lifecycle
  | 'chat_created'
  | 'chat_message_sent'
  | 'chat_archived'

  // Intent & AI
  | 'intent_classified'
  | 'agent_fallback'
  | 'mcp_tool_called'
  | 'mcp_tool_failed'
  | 'prompt_injection_attempt'

  // Product discovery
  | 'product_searched'
  | 'product_viewed'
  | 'product_card_clicked'

  // Cart
  | 'product_added_to_cart'
  | 'product_removed_from_cart'
  | 'cart_viewed'
  | 'cart_abandoned'

  // Checkout funnel
  | 'checkout_started'
  | 'checkout_address_completed'
  | 'checkout_gift_message_added'
  | 'checkout_delivery_slot_selected'
  | 'checkout_payment_method_selected'
  | 'checkout_order_placed'
  | 'checkout_order_failed'

  // Post-purchase
  | 'order_tracking_viewed'
  | 'reorder_initiated'

  // Voice
  | 'voice_recording_started'
  | 'voice_transcription_completed'
  | 'voice_transcription_failed'
  | 'tts_played'

  // Language
  | 'language_switched'
  | 'singlish_detected'
  | 'sinhala_detected'

  // Auth
  | 'guest_checkout_started'
  | 'user_signed_in'
  | 'user_signed_up';

export interface TrackParams {
  eventName: AnalyticsEventName;
  userId?:   string;
  sessionId?: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly posthog: PostHog | null = null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('POSTHOG_KEY');
    if (key) {
      this.posthog = new PostHog(key, {
        host:           'https://eu.posthog.com',  // EU data residency
        flushAt:        10,                         // Batch 10 events before flush
        flushInterval:  5000,                       // Or every 5 seconds
        disableGeoip:   true,                       // Don't capture IP location
      });
      this.logger.log('PostHog analytics initialized');
    } else {
      this.logger.warn('POSTHOG_KEY not set — analytics disabled');
    }
  }

  /**
   * Track a single event.
   * Never throws — analytics failures must not break core functionality.
   */
  async track(params: TrackParams): Promise<void> {
    if (!this.posthog) return;

    try {
      const distinctId = params.userId ?? params.sessionId ?? 'anonymous';

      this.posthog.capture({
        distinctId,
        event:      params.eventName,
        properties: {
          ...params.properties,
          // Standard context
          $lib:       'kapruka-agent-server',
          environment: process.env.NODE_ENV ?? 'production',
        },
      });
    } catch (err) {
      // Log but never throw — analytics must not block core flows
      this.logger.error(`Analytics track failed for ${params.eventName}:`, err);
    }
  }

  /**
   * Track a conversion funnel step.
   * Includes step index for funnel drop-off analysis in PostHog.
   */
  async trackFunnelStep(params: {
    funnel:    'checkout' | 'product_discovery';
    step:      string;
    stepIndex: number;
    userId?:   string;
    sessionId?: string;
    properties?: Record<string, unknown>;
  }): Promise<void> {
    await this.track({
      eventName:  `${params.funnel}_${params.step}` as AnalyticsEventName,
      userId:     params.userId,
      sessionId:  params.sessionId,
      properties: {
        funnel:     params.funnel,
        step:       params.step,
        step_index: params.stepIndex,
        ...(params.properties as Record<string, string | number | boolean | null | undefined>),
      },
    });
  }

  /**
   * Identify a user with traits.
   * Called on sign-in/sign-up. No PII in traits.
   */
  identify(params: {
    userId:     string;
    language?:  string;
    isGuest:    boolean;
  }): void {
    if (!this.posthog) return;

    this.posthog.identify({
      distinctId: params.userId,
      properties: {
        language:  params.language ?? 'EN',
        is_guest:  params.isGuest,
      },
    });
  }

  /**
   * Alias guest session to authenticated user (on sign-in after guest checkout).
   */
  alias(params: { guestSessionId: string; userId: string }): void {
    if (!this.posthog) return;

    this.posthog.alias({
      distinctId: params.userId,
      alias:      params.guestSessionId,
    });
  }

  async shutdown(): Promise<void> {
    await this.posthog?.shutdown();
  }
}

// ─── Frontend analytics hook ──────────────────────────────────────────────────
// File: frontend/src/hooks/useAnalytics.ts

/**
 * Client-side analytics hook.
 * Wraps PostHog browser SDK with typed event names.
 *
 * Usage:
 *   const { track } = useAnalytics();
 *   track('product_added_to_cart', { product_id: 'abc', price: 1500 });
 */
export const analyticsHookSource = `
'use client';
import posthog from 'posthog-js';
import { useCallback } from 'react';

type ClientEventName =
  | 'product_card_clicked'
  | 'cart_viewed'
  | 'checkout_started'
  | 'language_switched'
  | 'voice_recording_started'
  | 'suggestion_clicked';

export function useAnalytics() {
  const track = useCallback(
    (event: ClientEventName, properties?: Record<string, unknown>) => {
      // Don't block UI for analytics
      queueMicrotask(() => {
        posthog.capture(event, {
          ...properties,
          $lib: 'kapruka-agent-client',
        });
      });
    },
    [],
  );

  return { track };
}
` as const;

// ─── Key metrics to track in PostHog dashboards ──────────────────────────────

export const KEY_METRICS = {
  // Acquisition
  CHAT_STARTS_PER_DAY:          'count of chat_created per day',
  GUEST_VS_AUTHED_RATIO:        'split of is_guest property on chat_created',

  // Engagement
  MESSAGES_PER_SESSION:         'average count of chat_message_sent per chat_id',
  INTENT_DISTRIBUTION:          'breakdown of intent property on intent_classified',
  LANGUAGE_BREAKDOWN:           'breakdown of language on chat_message_sent',
  SINGLISH_ADOPTION:            'count of singlish_detected per day',

  // Product discovery
  SEARCH_TO_CART_RATE:          'funnel: product_searched → product_added_to_cart',
  MOST_SEARCHED_CATEGORIES:     'top 10 values of category on product_searched',

  // Conversion
  CART_TO_CHECKOUT_RATE:        'funnel: cart_viewed → checkout_started',
  CHECKOUT_COMPLETION_RATE:     'funnel: checkout_started → checkout_order_placed',
  CHECKOUT_DROP_OFF_BY_STEP:    'funnel by step_index on checkout_* events',
  AVERAGE_ORDER_VALUE:          'average of order_total on checkout_order_placed',

  // AI quality
  AGENT_FALLBACK_RATE:          'agent_fallback / chat_message_sent',
  MCP_TOOL_FAILURE_RATE:        'mcp_tool_failed / mcp_tool_called',
  INJECTION_ATTEMPTS_PER_DAY:   'count of prompt_injection_attempt per day',

  // Voice
  VOICE_ADOPTION_RATE:          'voice_recording_started / chat_message_sent',
  VOICE_SUCCESS_RATE:           'voice_transcription_completed / voice_recording_started',
} as const;