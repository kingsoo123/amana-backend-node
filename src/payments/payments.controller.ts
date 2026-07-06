import { Body, Controller, Headers, Post } from '@nestjs/common';
import type { FlutterwaveWebhookEvent } from './flutterwave-webhook.types';
import { PaymentsService } from './payments.service';

@Controller('api/v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhooks/flutterwave')
  async handleFlutterwaveWebhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: FlutterwaveWebhookEvent,
  ) {
    this.paymentsService.verifyWebhookSignature(headers);
    return this.paymentsService.handleWebhook(body);
  }
}
