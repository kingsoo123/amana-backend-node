import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';
import { Invoice } from '../invoices/invoice.entity';
import { UsersModule } from '../users/users.module';
import { EscrowSettlementService } from './escrow-settlement.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice]),
    AccountsModule,
    FlutterwaveModule,
    UsersModule,
  ],
  providers: [EscrowSettlementService],
  exports: [EscrowSettlementService],
})
export class EscrowModule {}
