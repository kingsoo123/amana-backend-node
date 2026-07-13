import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DisputesModule } from '../disputes/disputes.module';
import { Dispute } from '../disputes/dispute.entity';
import { EscrowModule } from '../escrow/escrow.module';
import { Invoice } from '../invoices/invoice.entity';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Invoice, Dispute]),
    UsersModule,
    DisputesModule,
    EscrowModule,
    AuthModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
