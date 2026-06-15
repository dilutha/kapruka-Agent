import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { McpClientService } from '../../mcp/mcp-client.service';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mcp: McpClientService,
    private readonly analytics: AnalyticsService,
  ) {}

  async createOrder(params: {
    items: Array<{ kaprukaProdId: string; name: string; unitPrice: number; quantity: number }>;
    shippingAddress: Record<string, string>;
    paymentMethod: string;
    giftMessage?: { fromName: string; toName: string; message: string; isAnonymous: boolean };
    userId?: string;
    guestUserId?: string;
    sessionToken?: string;
  }) {
    const subtotal     = params.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const deliveryFee  = 350; // Default delivery fee — real value from MCP in production
    const totalAmount  = subtotal + deliveryFee;

    // Place order via Kapruka MCP
    const kaprukResult = await this.mcp.placeOrder({
      cartId:          `local-${Date.now()}`,
      shippingAddress: params.shippingAddress as any,
      paymentMethod:   params.paymentMethod as any,
      giftMessage:     params.giftMessage,
      sessionToken:    params.sessionToken ?? '',
    });

    // Persist to our DB
    const order = await this.prisma.order.create({
      data: {
        userId:          params.userId ?? null,
        guestUserId:     params.guestUserId ?? null,
        kaprukOrderId:   kaprukResult.kaprukOrderId,
        status:          'PENDING',
        subtotal,
        deliveryFee,
        totalAmount,
        currency:        'LKR',
        shippingAddress: params.shippingAddress,
      },
    });

    await this.analytics.track({
      eventName:  'checkout_order_placed',
      userId:     params.userId,
      properties: { orderId: order.id, totalAmount, itemCount: params.items.length },
    });

    return order;
  }
}