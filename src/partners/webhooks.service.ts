import { createHmac, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { Partner } from './partner.entity';
import { PartnerWebhookDelivery } from './partner-webhook-delivery.entity';
import { toPartnerTransaction } from './transaction-mapper';

export type PartnerWebhookEventType =
  | 'transaction.created'
  | 'payment.initiated'
  | 'payment.funded'
  | 'receiver.confirmed'
  | 'escrow.released'
  | 'dispute.opened'
  | 'dispute.under_review'
  | 'dispute.resolved'
  | 'dispute.closed'
  | 'refund.completed';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Partner)
    private readonly partnersRepository: Repository<Partner>,
    @InjectRepository(PartnerWebhookDelivery)
    private readonly deliveriesRepository: Repository<PartnerWebhookDelivery>,
  ) {}

  async emitInvoiceEvent(
    type: PartnerWebhookEventType,
    invoice: Invoice,
    extra?: Record<string, unknown>,
  ) {
    if (!invoice.partnerId) {
      return;
    }

    const partner = await this.partnersRepository.findOne({
      where: { id: invoice.partnerId, status: 'active' },
    });

    if (!partner?.webhookUrl || !partner.webhookSecret) {
      return;
    }

    const frontendBaseUrl = this.resolveFrontendBaseUrl();
    const transaction = toPartnerTransaction(invoice, { frontendBaseUrl });

    const eventId = `evt_${randomBytes(8).toString('hex')}`;
    const payload = {
      id: eventId,
      type,
      createdAt: new Date().toISOString(),
      data: {
        transactionId: invoice.id,
        reference: invoice.invoiceNumber,
        amount: invoice.amount,
        currency: invoice.currency,
        status: transaction.status,
        paymentStatus: transaction.paymentStatus,
        deliveryStatus: transaction.deliveryStatus,
        externalReference: invoice.externalReference,
        metadata: invoice.metadata,
        ...extra,
      },
    };

    const delivery = await this.deliveriesRepository.save({
      partnerId: partner.id,
      eventId,
      type,
      invoiceId: invoice.id,
      payload,
      status: 'pending',
      attemptCount: 0,
    });

    void this.deliver(partner, delivery.id, payload);
  }

  private async deliver(
    partner: Partner,
    deliveryId: string,
    payload: Record<string, unknown>,
  ) {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', partner.webhookSecret as string)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    try {
      const response = await fetch(partner.webhookUrl as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Amana-Signature': `t=${timestamp},v1=${signature}`,
          'User-Agent': 'Amana-Webhooks/1.0',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      await this.deliveriesRepository.update(deliveryId, {
        attemptCount: 1,
        responseStatus: response.status,
        status: response.ok ? 'delivered' : 'failed',
        deliveredAt: response.ok ? new Date() : null,
        errorMessage: response.ok
          ? null
          : `HTTP ${response.status} ${response.statusText}`,
      });

      if (!response.ok) {
        this.logger.warn(
          `Webhook ${payload.id} failed for partner ${partner.id}: HTTP ${response.status}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown webhook error';
      await this.deliveriesRepository.update(deliveryId, {
        attemptCount: 1,
        status: 'failed',
        errorMessage: message,
      });
      this.logger.warn(
        `Webhook ${String(payload.id)} error for partner ${partner.id}: ${message}`,
      );
    }
  }

  private resolveFrontendBaseUrl() {
    const raw = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return raw.split(',')[0]?.trim() || 'http://localhost:3000';
  }
}
