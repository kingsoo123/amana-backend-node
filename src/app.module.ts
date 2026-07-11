import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { RevokedToken } from './auth/revoked-token.entity';
import { EmailOtp } from './auth/email-otp.entity';
import { VirtualAccount } from './accounts/virtual-account.entity';
import { BvnVerification } from './accounts/bvn-verification.entity';
import { AdminModule } from './admin/admin.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { Dispute } from './disputes/dispute.entity';
import { DisputesModule } from './disputes/disputes.module';
import { Invoice } from './invoices/invoice.entity';
import { InvoicesModule } from './invoices/invoices.module';
import { Notification } from './notifications/notification.entity';
import { NotificationsModule } from './notifications/notifications.module';
import { PartnerApiKey } from './partners/partner-api-key.entity';
import { PartnerAccessRequest } from './partners/partner-access-request.entity';
import { PartnerWebhookDelivery } from './partners/partner-webhook-delivery.entity';
import { Partner } from './partners/partner.entity';
import { PartnersModule } from './partners/partners.module';
import { PaymentsModule } from './payments/payments.module';
import { User } from './users/user.entity';
import { UsersModule } from './users/users.module';
import { buildTypeOrmConfig } from './config/database.config';

const databaseEntities = [
  User,
  RevokedToken,
  EmailOtp,
  VirtualAccount,
  BvnVerification,
  Invoice,
  Notification,
  Dispute,
  Partner,
  PartnerApiKey,
  PartnerWebhookDelivery,
  PartnerAccessRequest,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildTypeOrmConfig(configService, databaseEntities),
    }),
    UsersModule,
    AuthModule,
    AccountsModule,
    InvoicesModule,
    DisputesModule,
    CustomersModule,
    DashboardModule,
    AdminModule,
    NotificationsModule,
    PaymentsModule,
    PartnersModule,
  ],
})
export class AppModule {}
