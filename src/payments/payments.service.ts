import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoicesService } from '../invoices/invoices.service';
import {
  FlutterwaveCharge,
  FlutterwaveWebhookEvent,
} from './flutterwave-webhook.types';

const PAYMENT_REFERENCE_PATTERN = /PAY-[A-F0-9]+/i;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly invoicesService: InvoicesService,
  ) {}

  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const secret = this.configService.get<string>('FLUTTERWAVE_WEBHOOK_HASH');
    if (!secret?.trim()) {
      return;
    }

    const verifHash = this.headerValue(headers['verif-hash']);
    if (verifHash && verifHash === secret.trim()) {
      return;
    }

    throw new UnauthorizedException('Invalid Flutterwave webhook signature.');
  }

  async handleWebhook(event: FlutterwaveWebhookEvent) {
    if (event.type !== 'charge.completed') {
      return { received: true, matched: false };
    }

    const charge = this.resolveCharge(event.data);
    const paymentReference = this.extractPaymentReference(charge, event);

    if (!paymentReference) {
      this.logger.warn(
        `Webhook charge ${charge.id} has no invoice payment reference in narration`,
      );
      return { received: true, matched: false };
    }

    const status =
      charge.status === 'succeeded' || charge.status === 'successful'
        ? 'succeeded'
        : charge.status;

    const result = await this.invoicesService.applyPaymentFromWebhook({
      paymentReference,
      amount: Number(charge.amount),
      status,
      chargeId: charge.id ? String(charge.id) : null,
      chargeReference: charge.reference ? String(charge.reference) : null,
    });

    return {
      received: true,
      matched: result.matched,
      updated: 'updated' in result ? result.updated : false,
      invoiceId: 'invoiceId' in result ? result.invoiceId : null,
      invoiceNumber: 'invoiceNumber' in result ? result.invoiceNumber : null,
      paymentReference,
    };
  }

  private resolveCharge(data: FlutterwaveCharge): FlutterwaveCharge {
    const mockEnabled =
      this.configService.get<string>('FLUTTERWAVE_WEBHOOK_MOCK') === 'true' ||
      data.id.startsWith('MOCK-');

    if (mockEnabled) {
      const rawStatus = String(data.status ?? 'succeeded');
      const status =
        rawStatus === 'successful' || rawStatus === 'succeeded'
          ? 'succeeded'
          : rawStatus;

      return {
        ...data,
        amount: Number(data.amount),
        currency: data.currency ?? 'NGN',
        reference: data.reference ?? `mock-${data.id}`,
        status,
      };
    }

    return {
      ...data,
      amount: Number(data.amount),
      currency: data.currency ?? 'NGN',
      status: String(data.status ?? 'succeeded'),
    };
  }

  private extractPaymentReference(
    charge: FlutterwaveCharge,
    event: FlutterwaveWebhookEvent,
  ): string | null {
    const sources = [
      this.stringOrNull(charge.meta?.narration),
      this.stringOrNull(charge.description),
      this.stringOrNull(charge.reference),
      this.stringOrNull(event.data?.reference),
    ].filter(Boolean) as string[];

    for (const source of sources) {
      const match = source.match(PAYMENT_REFERENCE_PATTERN);
      if (match?.[0]) {
        return match[0].toUpperCase();
      }
    }

    return null;
  }

  private headerValue(
    value: string | string[] | undefined,
  ): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  private stringOrNull(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
