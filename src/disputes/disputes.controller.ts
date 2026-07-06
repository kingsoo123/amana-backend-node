import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { DisputesService } from './disputes.service';

@Controller('api/v1')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post('invoices/:invoiceId/disputes')
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: User,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CreateDisputeDto,
  ) {
    return this.disputesService.createForInvoice(user, invoiceId, dto);
  }

  @Get('disputes')
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser() user: User) {
    return this.disputesService.listForUser(user);
  }

  @Get('disputes/:id')
  @UseGuards(JwtAuthGuard)
  getOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.disputesService.getForUser(user, id);
  }
}
