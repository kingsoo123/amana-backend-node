import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from '../disputes/dispute.entity';
import { Invoice } from '../invoices/invoice.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Dispute])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
