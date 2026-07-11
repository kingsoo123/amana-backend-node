import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DisputesModule } from '../disputes/disputes.module';
import { Invoice } from '../invoices/invoice.entity';
import { InvoicesModule } from '../invoices/invoices.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AdminPartnersController } from './admin-partners.controller';
import { ApiKeyGuard } from './guards/api-key.guard';
import { PartnerAccessRequest } from './partner-access-request.entity';
import { PartnerApiKey } from './partner-api-key.entity';
import { PartnerWebhookDelivery } from './partner-webhook-delivery.entity';
import { Partner } from './partner.entity';
import { PartnersService } from './partners.service';
import { SellerPartnerAccessController } from './seller-partner-access.controller';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Partner,
      PartnerApiKey,
      PartnerWebhookDelivery,
      PartnerAccessRequest,
      Invoice,
    ]),
    UsersModule,
    AuthModule,
    NotificationsModule,
    forwardRef(() => InvoicesModule),
    forwardRef(() => DisputesModule),
  ],
  controllers: [
    TransactionsController,
    AdminPartnersController,
    SellerPartnerAccessController,
  ],
  providers: [
    PartnersService,
    TransactionsService,
    WebhooksService,
    ApiKeyGuard,
  ],
  exports: [PartnersService, WebhooksService],
})
export class PartnersModule {}
