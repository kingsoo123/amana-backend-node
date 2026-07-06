import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { RevokedToken } from './auth/revoked-token.entity';
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
import { PaymentsModule } from './payments/payments.module';
import { User } from './users/user.entity';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST', 'localhost'),
        port: configService.get<number>('DATABASE_PORT', 5432),
        username: configService.get<string>('DATABASE_USER', 'amana'),
        password: configService.get<string>('DATABASE_PASSWORD', 'amana'),
        database: configService.get<string>('DATABASE_NAME', 'amana'),
        entities: [User, RevokedToken, VirtualAccount, BvnVerification, Invoice, Notification, Dispute],
        synchronize: true,
      }),
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
  ],
})
export class AppModule {}
