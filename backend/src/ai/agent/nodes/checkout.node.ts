/**
 * Checkout Node
 *
 * A conversational state machine that collects everything
 * `kapruka_create_order` needs (recipient, phone, address, city, delivery
 * date, optional gift message) one field at a time, then exchanges the real
 * Kapruka cart for a genuine click-to-pay checkout URL. It never simulates
 * payment or fabricates an order confirmation — the shopper always finishes
 * on Kapruka's own real checkout page.
 *
 * Turn budget: exactly one Gemini call per turn while still collecting
 * fields (extraction + the reply text together — see
 * `PromptLibrary.getCheckoutTurnPrompt()`), zero Gemini calls once every
 * required field is known (the order summary and confirmation replies are
 * built deterministically, since a generated sentence must never be the
 * thing stating a price).
 */

import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import {
  AgentState,
  Address,
  CartItem,
  CheckoutStep,
  GiftMessageInput,
} from '../agent-orchestrator';
import {
  McpClientService,
  McpToolError,
} from '../../../mcp/mcp-client.service';
import { GeminiService } from '../../gemini/gemini.service';
import { PromptLibrary } from '../prompts/prompt-library';
import { Language } from '@prisma/client';

const CheckoutExtractionSchema = z.object({
  extracted: z
    .object({
      recipientName: z.string().max(80).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      addressLine1: z.string().max(250).nullable().optional(),
      city: z.string().max(100).nullable().optional(),
      deliveryDate: z.string().max(20).nullable().optional(),
      wantsGiftMessage: z.boolean().nullable().optional(),
      giftFromName: z.string().max(80).nullable().optional(),
      giftMessageText: z.string().max(300).nullable().optional(),
      giftAnonymous: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
  confirms: z.boolean(),
  cancels: z.boolean(),
  responseText: z.string().max(600),
});
type CheckoutExtraction = z.infer<typeof CheckoutExtractionSchema>;

type RequiredField =
  | 'recipientName'
  | 'phone'
  | 'addressLine1'
  | 'city'
  | 'deliveryDate';

const CANCEL_PATTERN =
  /\b(cancel|never\s*mind|nevermind|stop|epaa|epa|nathi karanna|hari na|leave it)\b/i;
const CONFIRM_PATTERN =
  /^\s*(yes|yeah|yep|yup|confirm(ed)?|correct|ok(ay)?|place\s*(the\s*)?order|go\s*ahead|sounds?\s*good|hari|ow|owu|ඔව්)\s*[!.]*\s*$/i;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class CheckoutNode {
  private readonly logger = new Logger(CheckoutNode.name);

  constructor(
    private readonly mcp: McpClientService,
    private readonly gemini: GeminiService,
    private readonly prompts: PromptLibrary,
  ) {}

  async invoke(state: AgentState): Promise<Partial<AgentState>> {
    // ADD_TO_CART/REMOVE_FROM_CART route here (see agent-orchestrator's
    // routeByIntent) but this backend has no server-side cart to mutate —
    // the cart lives in the browser (Zustand/localStorage), and this node
    // only ever *reads* a snapshot of it via state.cartItems. Answering
    // these with the real address-collection flow would be a bug (the user
    // asked to add flowers, not start checkout), so they get a short,
    // honest redirect to the actual UI control instead.
    if (state.intent === 'ADD_TO_CART' || state.intent === 'REMOVE_FROM_CART') {
      return {
        response: this.cartActionHint(state.language),
        responseType: 'text',
      };
    }

    const cartItems = state.cartItems ?? [];
    if (cartItems.length === 0) {
      return {
        response: this.emptyCartMessage(state.language),
        responseType: 'text',
      };
    }

    const userText = this.lastHumanMessageText(state);

    if (CANCEL_PATTERN.test(userText)) {
      return this.resetCheckout(state.language);
    }

    const step: CheckoutStep = state.checkoutStep ?? 'address';

    if (step === 'confirm') {
      return this.handleConfirmStep(state, userText, cartItems);
    }

    return this.handleCollectionStep(state, userText, cartItems);
  }

  // ─── Collection (address / delivery_date / gift_message) ────────────────

  private async handleCollectionStep(
    state: AgentState,
    userText: string,
    cartItems: CartItem[],
  ): Promise<Partial<AgentState>> {
    const currentAddress = state.shippingAddress;
    const currentDate = state.deliveryDate;
    const requiredMissing = this.nextRequiredField(currentAddress, currentDate);
    const askingGiftMessage = requiredMissing === null;

    let extraction: CheckoutExtraction;
    try {
      extraction = await this.extractFields({
        state,
        userText,
        cartItems,
        hint: requiredMissing ?? 'recipientName',
        askingGiftMessage,
      });
    } catch (error) {
      this.logger.error('Checkout extraction failed:', error);
      return {
        response: this.genericRetryMessage(state.language),
        responseType: 'checkout',
        checkoutStep: state.checkoutStep,
      };
    }

    if (extraction.cancels) return this.resetCheckout(state.language);

    const extracted = extraction.extracted ?? {};
    const mergedAddress: Address = {
      recipientName:
        extracted.recipientName?.trim() || currentAddress?.recipientName || '',
      phone: extracted.phone?.trim() || currentAddress?.phone || '',
      addressLine1:
        extracted.addressLine1?.trim() || currentAddress?.addressLine1 || '',
      city: extracted.city?.trim() || currentAddress?.city || '',
    };
    const mergedDate =
      extracted.deliveryDate && ISO_DATE_PATTERN.test(extracted.deliveryDate)
        ? extracted.deliveryDate
        : currentDate;

    let mergedGiftMessage: GiftMessageInput | undefined = state.giftMessage;
    if (askingGiftMessage && extracted.giftMessageText?.trim()) {
      mergedGiftMessage = {
        fromName: extracted.giftFromName?.trim() || mergedAddress.recipientName,
        toName: mergedAddress.recipientName,
        message: extracted.giftMessageText.trim().slice(0, 300),
        isAnonymous: extracted.giftAnonymous ?? false,
      };
    }

    const stillMissing = this.nextRequiredField(mergedAddress, mergedDate);

    if (stillMissing) {
      return {
        response: extraction.responseText,
        responseType: 'checkout',
        shippingAddress: mergedAddress,
        deliveryDate: mergedDate,
        giftMessage: mergedGiftMessage,
        checkoutStep:
          stillMissing === 'deliveryDate' ? 'delivery_date' : 'address',
      };
    }

    // Required fields are all in — the gift-message step is a one-shot ask:
    // once we've asked (this very turn, when askingGiftMessage flips true
    // for the first time), the following turn moves straight to a
    // deterministic confirm summary regardless of what they said.
    if (!askingGiftMessage) {
      return {
        response: extraction.responseText,
        responseType: 'checkout',
        shippingAddress: mergedAddress,
        deliveryDate: mergedDate,
        checkoutStep: 'gift_message',
      };
    }

    return this.buildConfirmSummary(
      state.language,
      mergedAddress,
      mergedDate!,
      mergedGiftMessage,
      cartItems,
    );
  }

  private async extractFields(params: {
    state: AgentState;
    userText: string;
    cartItems: CartItem[];
    hint: RequiredField | 'giftMessage';
    askingGiftMessage: boolean;
  }): Promise<CheckoutExtraction> {
    const known: Record<string, string> = {};
    const addr = params.state.shippingAddress;
    if (addr?.recipientName) known.recipientName = addr.recipientName;
    if (addr?.phone) known.phone = addr.phone;
    if (addr?.addressLine1) known.addressLine1 = addr.addressLine1;
    if (addr?.city) known.city = addr.city;
    if (params.state.deliveryDate)
      known.deliveryDate = params.state.deliveryDate;

    return this.gemini.generateJson<CheckoutExtraction>({
      systemInstruction: this.prompts.getCheckoutTurnPrompt({
        language: params.state.language,
        cartItemNames: params.cartItems.map((i) => `${i.name} x${i.quantity}`),
        knownFields: known,
        nextMissingField: params.hint,
        todayIso: this.colomboToday(),
      }),
      prompt: params.userText,
      schema: this.gemini.createCheckoutExtractionSchema(),
      validator: CheckoutExtractionSchema,
      temperature: 0.3,
      maxOutputTokens: 300,
    });
  }

  private nextRequiredField(
    address: Address | undefined,
    deliveryDate: string | undefined,
  ): RequiredField | null {
    if (!address?.recipientName) return 'recipientName';
    if (!address?.phone) return 'phone';
    if (!address?.addressLine1) return 'addressLine1';
    if (!address?.city) return 'city';
    if (!deliveryDate) return 'deliveryDate';
    return null;
  }

  private colomboToday(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
  }

  // ─── Confirm ──────────────────────────────────────────────────────────────

  private buildConfirmSummary(
    language: Language,
    address: Address,
    deliveryDate: string,
    giftMessage: GiftMessageInput | undefined,
    cartItems: CartItem[],
  ): Partial<AgentState> {
    const subtotal = cartItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const itemLines = cartItems
      .map(
        (i) =>
          `• ${i.name} × ${i.quantity} — LKR ${(i.unitPrice * i.quantity).toLocaleString()}`,
      )
      .join('\n');

    const templates: Record<Language, string> = {
      [Language.EN]: `Here's your order so far:\n\n${itemLines}\n\nSubtotal: LKR ${subtotal.toLocaleString()} (delivery fee is added on the payment page)\n\nDeliver to: ${address.recipientName}, ${address.addressLine1}, ${address.city}\nPhone: ${address.phone}  •  Date: ${deliveryDate}${giftMessage ? `\nGift message: "${giftMessage.message}"` : ''}\n\nShall I get your payment link? Reply "yes" to confirm, or tell me what to change.`,
      [Language.SI]: `ඔබේ ඇණවුම:\n\n${itemLines}\n\nමුළු එකතුව: රු. ${subtotal.toLocaleString()} (delivery fee එක payment page එකේදී එකතු වේ)\n\nලිපිනය: ${address.recipientName}, ${address.addressLine1}, ${address.city}\nදුරකථනය: ${address.phone}  •  දිනය: ${deliveryDate}${giftMessage ? `\nතෑගි පණිවිඩය: "${giftMessage.message}"` : ''}\n\nPayment link එක දෙන්නද? තහවුරු කිරීමට "yes" කියන්න.`,
      [Language.SINGLISH]: `Okay machan, order eka methana:\n\n${itemLines}\n\nSubtotal: LKR ${subtotal.toLocaleString()} (delivery fee payment page eke add wenawa)\n\nDeliver karanne: ${address.recipientName}, ${address.addressLine1}, ${address.city}\nPhone: ${address.phone}  •  Date: ${deliveryDate}${giftMessage ? `\nGift message: "${giftMessage.message}"` : ''}\n\nPayment link eka ganna da? "yes" kiyala confirm karanna, nathnam mokakda change karanna one kiyanna.`,
    };

    return {
      response: templates[language] ?? templates[Language.EN],
      responseType: 'checkout',
      shippingAddress: address,
      deliveryDate,
      giftMessage,
      checkoutStep: 'confirm',
    };
  }

  private async handleConfirmStep(
    state: AgentState,
    userText: string,
    cartItems: CartItem[],
  ): Promise<Partial<AgentState>> {
    if (!CONFIRM_PATTERN.test(userText.trim())) {
      // Not a clean yes — might be a correction ("my phone is actually
      // 0779...") rather than confusion. Reuse the same extraction call to
      // pick up any corrected field, then re-render the summary — cheaper
      // and more forgiving than forcing a hard "yes/no" gate.
      let extraction: CheckoutExtraction;
      try {
        extraction = await this.extractFields({
          state,
          userText,
          cartItems,
          hint: 'recipientName',
          askingGiftMessage: false,
        });
      } catch (error) {
        this.logger.error('Checkout confirm-step extraction failed:', error);
        return {
          response: this.genericRetryMessage(state.language),
          responseType: 'checkout',
          checkoutStep: 'confirm',
        };
      }

      if (extraction.cancels) return this.resetCheckout(state.language);
      if (extraction.confirms) {
        return this.placeRealOrder(state, cartItems);
      }

      const extracted = extraction.extracted ?? {};
      const address: Address = {
        recipientName:
          extracted.recipientName?.trim() ||
          state.shippingAddress!.recipientName,
        phone: extracted.phone?.trim() || state.shippingAddress!.phone,
        addressLine1:
          extracted.addressLine1?.trim() || state.shippingAddress!.addressLine1,
        city: extracted.city?.trim() || state.shippingAddress!.city,
      };
      const deliveryDate =
        extracted.deliveryDate && ISO_DATE_PATTERN.test(extracted.deliveryDate)
          ? extracted.deliveryDate
          : state.deliveryDate!;

      return this.buildConfirmSummary(
        state.language,
        address,
        deliveryDate,
        state.giftMessage,
        cartItems,
      );
    }

    return this.placeRealOrder(state, cartItems);
  }

  private async placeRealOrder(
    state: AgentState,
    cartItems: CartItem[],
  ): Promise<Partial<AgentState>> {
    const address = state.shippingAddress!;
    const deliveryDate = state.deliveryDate!;

    try {
      const delivery = await this.mcp.checkDelivery({
        city: address.city,
        deliveryDate,
      });

      if (!delivery.available) {
        return {
          response: this.deliveryUnavailableMessage(state.language, delivery),
          responseType: 'checkout',
          checkoutStep: 'delivery_date',
          deliveryDate: undefined,
        };
      }

      const order = await this.mcp.placeOrder({
        cart: cartItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        recipient: { name: address.recipientName, phone: address.phone },
        delivery: {
          address: address.addressLine1,
          city: address.city,
          date: deliveryDate,
        },
        sender: {
          name: state.giftMessage?.fromName ?? address.recipientName,
          anonymous: state.giftMessage?.isAnonymous ?? false,
        },
        giftMessage: state.giftMessage?.message,
      });

      return {
        response: this.orderPlacedMessage(state.language, order),
        responseType: 'checkout',
        checkoutStep: 'placed',
        orderRef: order.order_ref,
        checkoutUrl: order.checkout_url,
        orderSummary: {
          itemsTotal: order.summary.items_total,
          deliveryFee: order.summary.delivery_fee,
          addonsTotal: order.summary.addons_total,
          grandTotal: order.summary.grand_total,
          currency: order.summary.currency,
        },
      };
    } catch (error) {
      if (error instanceof McpToolError) {
        return {
          response: this.friendlyToolError(state.language, error),
          responseType: 'checkout',
          checkoutStep: 'confirm',
        };
      }
      this.logger.error('placeOrder failed:', error);
      return {
        response: this.genericRetryMessage(state.language),
        responseType: 'checkout',
        checkoutStep: 'confirm',
      };
    }
  }

  // ─── Reset / short messages ───────────────────────────────────────────────

  private resetCheckout(language: Language): Partial<AgentState> {
    const messages: Record<Language, string> = {
      [Language.EN]:
        "No problem, I've cancelled checkout. Your cart is still saved — let me know whenever you're ready to continue.",
      [Language.SI]:
        'ඕකේ, checkout එක cancel කළා. ඔබේ cart එක තාම save වෙලා තියෙනවා — ready වෙලාම කියන්න.',
      [Language.SINGLISH]:
        'Okay machan, checkout cancel karala. Cart eka thama save wela thiyenawa — ready unama kiyanna.',
    };
    return {
      response: messages[language] ?? messages[Language.EN],
      responseType: 'text',
      checkoutStep: undefined,
      shippingAddress: undefined,
      deliveryDate: undefined,
      giftMessage: undefined,
    };
  }

  private cartActionHint(language: Language): string {
    const messages: Record<Language, string> = {
      [Language.EN]:
        "Tap \"+ Cart\" on the product card above to add or remove it — I'll remember what's in your cart when you're ready to checkout 🛒",
      [Language.SI]:
        'Product card එකේ "+ Cart" button එක click කරන්න add/remove කරන්න — checkout කරද්දී මම ඒක මතක තියාගන්නම් 🛒',
      [Language.SINGLISH]:
        'Product card eke "+ Cart" button eka click karanna add/remove karanna — checkout karana welawe mama eka remember karannam 🛒',
    };
    return messages[language] ?? messages[Language.EN];
  }

  private emptyCartMessage(language: Language): string {
    const messages: Record<Language, string> = {
      [Language.EN]:
        "Your cart is empty right now — let's find something first! What are you shopping for?",
      [Language.SI]:
        'ඔබේ cart එක හිස්. මුලින්ම මොකක් හරි හොයමුද? මොනවද ඕන කරන්නේ?',
      [Language.SINGLISH]:
        'Cart eka empty machan. Mokakwath hoyamu kanna — mokakda oyata one?',
    };
    return messages[language] ?? messages[Language.EN];
  }

  private genericRetryMessage(language: Language): string {
    const messages: Record<Language, string> = {
      [Language.EN]:
        'Sorry, something went wrong on my end. Could you say that again?',
      [Language.SI]: 'සමාවෙන්න, දෝෂයක් ආවා. ආයෙත් කියන්න පුළුවන්ද?',
      [Language.SINGLISH]:
        'Sorry machan, mokakwath error ekak una. Ayeth kiyanna puluwanda?',
    };
    return messages[language] ?? messages[Language.EN];
  }

  private deliveryUnavailableMessage(
    language: Language,
    delivery: { reason?: string | null; next_available_date?: string | null },
  ): string {
    const next = delivery.next_available_date
      ? ` The next available date is ${delivery.next_available_date}.`
      : '';
    const reason = delivery.reason ? ` (${delivery.reason})` : '';
    const messages: Record<Language, string> = {
      [Language.EN]: `Sorry, delivery isn't available on that date${reason}.${next} What date would you like instead?`,
      [Language.SI]: `සමාවෙන්න, ඒ දිනයේ delivery නෑ${reason}.${next} වෙන දිනයක් කියන්න.`,
      [Language.SINGLISH]: `Sorry machan, e date eke delivery na${reason}.${next} Wena date ekak kiyanna.`,
    };
    return messages[language] ?? messages[Language.EN];
  }

  private friendlyToolError(language: Language, error: McpToolError): string {
    const messages: Record<Language, string> = {
      [Language.EN]: `I couldn't place that order (${error.rawMessage.replace(/^Error\s*(\([^)]*\))?:?\s*/i, '')}). Could you double-check the details?`,
      [Language.SI]: `ඇණවුම place කරන්න බැරි උනා (${error.rawMessage.replace(/^Error\s*(\([^)]*\))?:?\s*/i, '')}). details ආයෙත් check කරන්න.`,
      [Language.SINGLISH]: `Order eka place karanna bae una (${error.rawMessage.replace(/^Error\s*(\([^)]*\))?:?\s*/i, '')}). Details ayeth check karanna.`,
    };
    return messages[language] ?? messages[Language.EN];
  }

  private orderPlacedMessage(
    language: Language,
    order: {
      checkout_url: string;
      order_ref: string;
      summary: { grand_total: number; currency: string };
    },
  ): string {
    const total = `${order.summary.currency} ${order.summary.grand_total.toLocaleString()}`;
    const messages: Record<Language, string> = {
      [Language.EN]: `All set! Your order **${order.order_ref}** is ready — total ${total}. Complete your payment securely on Kapruka here: ${order.checkout_url}\n\n(This link is valid for 60 minutes and locks in your price.)`,
      [Language.SI]: `හරි! ඔබේ ඇණවුම **${order.order_ref}** ready — total ${total}. Payment එක සම්පූර්ණ කරන්න: ${order.checkout_url}\n\n(මෙම link එක විනාඩි 60ක් valid.)`,
      [Language.SINGLISH]: `Hari machan! Order eka **${order.order_ref}** ready — total ${total}. Payment eka methanin complete karanna: ${order.checkout_url}\n\n(Link eka 60 minutes valid, price eka lock una.)`,
    };
    return messages[language] ?? messages[Language.EN];
  }

  private lastHumanMessageText(state: AgentState): string {
    const lastHuman = [...state.messages]
      .reverse()
      .find((m) => m._getType() === 'human');
    if (!lastHuman) return '';
    return typeof lastHuman.content === 'string'
      ? lastHuman.content
      : JSON.stringify(lastHuman.content);
  }
}
