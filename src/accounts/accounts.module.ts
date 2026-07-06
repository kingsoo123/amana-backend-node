import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';
import { UsersModule } from '../users/users.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { BvnVerification } from './bvn-verification.entity';
import { VirtualAccount } from './virtual-account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([VirtualAccount, BvnVerification]),
    FlutterwaveModule,
    UsersModule,
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
