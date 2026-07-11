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
}
