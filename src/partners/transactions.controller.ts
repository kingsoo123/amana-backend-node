import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPartner } from './decorators/current-partner.decorator';
import { ConfirmTransactionDto } from './dto/confirm-transaction.dto';
import { CreatePartnerDisputeDto } from './dto/create-partner-dispute.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { CreateDisputeMessageDto } from '../disputes/dto/create-dispute-message.dto';
import { SignDisputeUploadDto } from '../disputes/dto/sign-dispute-upload.dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import { Partner } from './partner.entity';
import { TransactionsService } from './transactions.service';

@Controller('api/v1/transactions')
@UseGuards(ApiKeyGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(
    @CurrentPartner() partner: Partner,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.transactionsService.create(partner, dto);
  }

  @Get(':id/delivery-otp')
  getDeliveryOtp(@CurrentPartner() partner: Partner, @Param('id') id: string) {
    return this.transactionsService.getDeliveryOtp(partner, id);
  }

  @Get(':id')
  get(@CurrentPartner() partner: Partner, @Param('id') id: string) {
    return this.transactionsService.get(partner, id);
  }

  @Post(':id/confirm')
  confirm(
    @CurrentPartner() partner: Partner,
    @Param('id') id: string,
    @Body() dto: ConfirmTransactionDto,
  ) {
    return this.transactionsService.confirm(partner, id, dto);
  }

  @Post(':id/disputes')
  openDispute(
    @CurrentPartner() partner: Partner,
    @Param('id') id: string,
    @Body() dto: CreatePartnerDisputeDto,
  ) {
    return this.transactionsService.openDispute(partner, id, dto);
  }

  @Get(':id/disputes/:disputeId/messages')
  listDisputeMessages(
    @CurrentPartner() partner: Partner,
    @Param('id') id: string,
    @Param('disputeId') disputeId: string,
  ) {
    return this.transactionsService.listDisputeMessages(partner, id, disputeId);
  }

  @Post(':id/disputes/:disputeId/messages')
  postDisputeMessage(
    @CurrentPartner() partner: Partner,
    @Param('id') id: string,
    @Param('disputeId') disputeId: string,
    @Body() dto: CreateDisputeMessageDto,
  ) {
    return this.transactionsService.postDisputeMessage(
      partner,
      id,
      disputeId,
      dto,
    );
  }

  @Post(':id/disputes/:disputeId/uploads/sign')
  signDisputeUpload(
    @CurrentPartner() partner: Partner,
    @Param('id') id: string,
    @Param('disputeId') disputeId: string,
    @Body() dto: SignDisputeUploadDto,
  ) {
    return this.transactionsService.signDisputeUpload(
      partner,
      id,
      disputeId,
      dto,
    );
  }
}
