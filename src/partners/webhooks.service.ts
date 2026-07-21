import { createHmac, randomBytes } from 'crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { Partner } from './partner.entity';
import {
  PartnerWebhookDelivery,
  WebhookDeliveryStatus,
} from './partner-webhook-delivery.entity';
import { toPartnerTransaction } from './transaction-mapper';

export type PartnerWebhookEventType =
  | 'transaction.created'
  | 'payment.initiated'
  | 'payment.funded'
  | 'transaction.cancelled'
  | 'receiver.confirmed'
  | 'escrow.released'
  | 'dispute.opened'
  | 'dispute.under_review'
  | 'dispute.resolved'
  | 'dispute.closed'
  | 'refund.completed'
  | 'refund.processing';

/** Delay before the next attempt after attemptCount failures (index = attemptCount). */
const BACKOFF_MS = [
  0, // unused — first attempt is immediate
  30_000, // 30s
  2 * 60_000, // 2m
  10 * 60_000, // 10m
  30 * 60_000, // 30m
  2 * 60 * 60_000, // 2h
  6 * 60 * 60_000, // 6h
  24 * 60 * 60_000, // 24h
] as const;

const MAX_ATTEMPTS = BACKOFF_MS.length;
const PROCESS_INTERVAL_MS = 15_000;
const BATCH_SIZE = 25;

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    @InjectRepository(Partner)
    private readonly partnersRepository: Repository<Partner>,
    @InjectRepository(PartnerWebhookDelivery)
    private readonly deliveriesRepository: Repository<PartnerWebhookDelivery>,
  ) {}

  onModuleInit() {
    void this.migrateLegacyFailedDeliveries().then(() =>
      this.processDueDeliveries(),
    );
    this.timer = setInterval(() => {
      void this.processDueDeliveries();
    }, PROCESS_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Older one-shot failures become retryable under the new worker. */
  private async migrateLegacyFailedDeliveries() {
    await this.deliveriesRepository
      .createQueryBuilder()
      .update(PartnerWebhookDelivery)
      .set({
        status: 'pending',
        nextAttemptAt: new Date(),
      })
      .where("status = 'failed'")
      .execute();
  }

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
      nextAttemptAt: new Date(),
      lastAttemptAt: null,
      responseStatus: null,
      errorMessage: null,
      deliveredAt: null,
    });

    void this.attemptDelivery(delivery.id);
  }

  async listDeliveries(input: {
    partnerId?: string;
    status?: WebhookDeliveryStatus;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const qb = this.deliveriesRepository
      .createQueryBuilder('delivery')
      .leftJoinAndSelect('delivery.partner', 'partner')
      .orderBy('delivery.created_at', 'DESC')
      .take(limit);

    if (input.partnerId) {
      qb.andWhere('delivery.partner_id = :partnerId', {
        partnerId: input.partnerId,
      });
    }

    if (input.status) {
      qb.andWhere('delivery.status = :status', { status: input.status });
    }

    const [items, total] = await qb.getManyAndCount();

    const summary = await this.summarizeDeliveries(input.partnerId);

    return {
      data: {
        summary,
        items: items.map((item) => this.toDeliveryResponse(item)),
      },
      meta: { total, limit },
    };
  }

  async retryDelivery(deliveryId: string, partnerId?: string) {
    const delivery = await this.deliveriesRepository.findOne({
      where: { id: deliveryId },
      relations: { partner: true },
    });

    if (!delivery) {
      throw new NotFoundException('Webhook delivery not found');
    }

    if (partnerId && delivery.partnerId !== partnerId) {
      throw new NotFoundException('Webhook delivery not found');
    }

    if (delivery.status === 'delivered') {
      return {
        message: 'Webhook already delivered',
        data: this.toDeliveryResponse(delivery),
      };
    }

    delivery.status = 'pending';
    delivery.nextAttemptAt = new Date();
    delivery.errorMessage = null;
    await this.deliveriesRepository.save(delivery);

    await this.attemptDelivery(delivery.id);

    const refreshed = await this.deliveriesRepository.findOne({
      where: { id: deliveryId },
      relations: { partner: true },
    });

    return {
      message:
        refreshed?.status === 'delivered'
          ? 'Webhook delivered successfully'
          : refreshed?.status === 'dead_letter'
            ? 'Webhook delivery failed and moved to dead letter'
            : 'Webhook retry queued',
      data: this.toDeliveryResponse(refreshed ?? delivery),
    };
  }

  async processDueDeliveries() {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      const now = new Date();
      const due = await this.deliveriesRepository.find({
        where: {
          status: 'pending',
          nextAttemptAt: LessThanOrEqual(now),
        },
        order: { nextAttemptAt: 'ASC' },
        take: BATCH_SIZE,
      });

      for (const delivery of due) {
        await this.attemptDelivery(delivery.id);
      }
    } catch (error) {
      this.logger.error(
        `Webhook processor error: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    } finally {
      this.processing = false;
    }
  }

  private async attemptDelivery(deliveryId: string) {
    const delivery = await this.deliveriesRepository.findOne({
      where: { id: deliveryId },
    });

    if (!delivery || delivery.status === 'delivered') {
      return;
    }

    if (
      delivery.status === 'pending' &&
      delivery.nextAttemptAt &&
      delivery.nextAttemptAt.getTime() > Date.now() + 1_000
    ) {
      return;
    }

    const partner = await this.partnersRepository.findOne({
      where: { id: delivery.partnerId },
    });

    if (!partner?.webhookUrl || !partner.webhookSecret) {
      delivery.status = 'dead_letter';
      delivery.errorMessage =
        'Partner webhook URL or secret is missing — cannot deliver';
      delivery.nextAttemptAt = null;
      delivery.lastAttemptAt = new Date();
      await this.deliveriesRepository.save(delivery);
      return;
    }

    if (partner.status !== 'active') {
      delivery.status = 'dead_letter';
      delivery.errorMessage = 'Partner is not active';
      delivery.nextAttemptAt = null;
      delivery.lastAttemptAt = new Date();
      await this.deliveriesRepository.save(delivery);
      return;
    }

    delivery.attemptCount += 1;
    delivery.lastAttemptAt = new Date();

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', partner.webhookSecret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    try {
      const response = await fetch(partner.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Amana-Signature': `t=${timestamp},v1=${signature}`,
          'User-Agent': 'Amana-Webhooks/1.0',
          'X-Amana-Delivery-Id': delivery.id,
          'X-Amana-Event-Id': delivery.eventId,
          'X-Amana-Attempt': String(delivery.attemptCount),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      delivery.responseStatus = response.status;

      if (response.ok) {
        delivery.status = 'delivered';
        delivery.deliveredAt = new Date();
        delivery.errorMessage = null;
        delivery.nextAttemptAt = null;
        await this.deliveriesRepository.save(delivery);
        return;
      }

      const responseText = await response.text().catch(() => '');
      delivery.errorMessage = `HTTP ${response.status} ${response.statusText}${
        responseText ? `: ${responseText.slice(0, 240)}` : ''
      }`;
      this.scheduleRetryOrDeadLetter(delivery);
      await this.deliveriesRepository.save(delivery);
      this.logger.warn(
        `Webhook ${delivery.eventId} attempt ${delivery.attemptCount} failed for partner ${partner.id}: ${delivery.errorMessage}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown webhook error';
      delivery.responseStatus = null;
      delivery.errorMessage = message;
      this.scheduleRetryOrDeadLetter(delivery);
      await this.deliveriesRepository.save(delivery);
      this.logger.warn(
        `Webhook ${delivery.eventId} attempt ${delivery.attemptCount} error for partner ${partner.id}: ${message}`,
      );
    }
  }

  private scheduleRetryOrDeadLetter(delivery: PartnerWebhookDelivery) {
    if (delivery.attemptCount >= MAX_ATTEMPTS) {
      delivery.status = 'dead_letter';
      delivery.nextAttemptAt = null;
      return;
    }

    const delay =
      BACKOFF_MS[delivery.attemptCount] ??
      BACKOFF_MS[BACKOFF_MS.length - 1];
    delivery.status = 'pending';
    delivery.nextAttemptAt = new Date(Date.now() + delay);
  }

  private async summarizeDeliveries(partnerId?: string) {
    const qb = this.deliveriesRepository
      .createQueryBuilder('delivery')
      .select('delivery.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('delivery.status');

    if (partnerId) {
      qb.where('delivery.partner_id = :partnerId', { partnerId });
    }

    const rows = await qb.getRawMany<{ status: string; count: string }>();
    const counts = {
      pending: 0,
      delivered: 0,
      dead_letter: 0,
      total: 0,
    };

    for (const row of rows) {
      const count = Number(row.count) || 0;
      counts.total += count;
      if (row.status === 'pending') {
        counts.pending = count;
      } else if (row.status === 'delivered') {
        counts.delivered = count;
      } else if (row.status === 'dead_letter' || row.status === 'failed') {
        counts.dead_letter += count;
      }
    }

    return counts;
  }

  private toDeliveryResponse(delivery: PartnerWebhookDelivery) {
    return {
      id: delivery.id,
      eventId: delivery.eventId,
      type: delivery.type,
      invoiceId: delivery.invoiceId,
      status: delivery.status === ('failed' as string) ? 'dead_letter' : delivery.status,
      responseStatus: delivery.responseStatus,
      errorMessage: delivery.errorMessage,
      attemptCount: delivery.attemptCount,
      maxAttempts: MAX_ATTEMPTS,
      nextAttemptAt: delivery.nextAttemptAt
        ? delivery.nextAttemptAt.toISOString()
        : null,
      lastAttemptAt: delivery.lastAttemptAt
        ? delivery.lastAttemptAt.toISOString()
        : null,
      createdAt: delivery.createdAt.toISOString(),
      deliveredAt: delivery.deliveredAt
        ? delivery.deliveredAt.toISOString()
        : null,
      partner: delivery.partner
        ? {
            id: delivery.partner.id,
            name: delivery.partner.name,
          }
        : null,
    };
  }

  private resolveFrontendBaseUrl() {
    const raw = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return raw.split(',')[0]?.trim() || 'http://localhost:3000';
  }
}
