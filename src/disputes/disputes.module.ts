import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { EscrowModule } from '../escrow/escrow.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PartnersModule } from '../partners/partners.module';
import { UsersModule } from '../users/users.module';
import { Dispute } from './dispute.entity';
import { DisputeMessage } from './dispute-message.entity';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dispute, DisputeMessage, Invoice]),
    NotificationsModule,
    UsersModule,
    EscrowModule,
    MediaModule,
    forwardRef(() => PartnersModule),
  ],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
