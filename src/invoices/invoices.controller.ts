import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { ShareBuyerLocationDto } from './dto/share-buyer-location.dto';
import { InvoicesService } from './invoices.service';

@Controller('api/v1/invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: User, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.createInvoice(user, dto);
  }

  @Get('buyers/search')
  @UseGuards(JwtAuthGuard)
  searchBuyers(@CurrentUser() user: User, @Query('q') query: string) {
    return this.invoicesService.searchBuyers(user, query ?? '');
  }

  @Get('sent')
  @UseGuards(JwtAuthGuard)
  listSent(@CurrentUser() user: User) {
    return this.invoicesService.listSent(user.id);
  }

  @Get('received')
  @UseGuards(JwtAuthGuard)
  listReceived(@CurrentUser() user: User) {
    return this.invoicesService.listReceived(user.email, user.id);
  }

  @Get('public/:shareToken')
  getPublic(@Param('shareToken') shareToken: string) {
    return this.invoicesService.getPublicPaymentView(shareToken);
  }

  @Post('public/:shareToken/initiate-payment')
  initiatePublic(@Param('shareToken') shareToken: string) {
    return this.invoicesService.initiatePaymentByShareToken(shareToken);
  }

  @Post('public/:shareToken/buyer-location')
  shareBuyerLocation(
    @Param('shareToken') shareToken: string,
    @Body() dto: ShareBuyerLocationDto,
  ) {
    return this.invoicesService.shareBuyerLocation(shareToken, dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.invoicesService.getInvoiceForUser(user, id);
  }

  @Get(':id/tracking')
  @UseGuards(JwtAuthGuard)
  getTracking(@CurrentUser() user: User, @Param('id') id: string) {
    return this.invoicesService.getDeliveryTracking(user, id);
  }

  @Post(':id/buyer-location')
  @UseGuards(JwtAuthGuard)
  shareBuyerLocationAuthenticated(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ShareBuyerLocationDto,
  ) {
    return this.invoicesService.shareBuyerLocationForUser(user, id, dto);
  }

  @Post(':id/initiate-payment')
  @UseGuards(JwtAuthGuard)
  initiatePayment(@CurrentUser() user: User, @Param('id') id: string) {
    return this.invoicesService.initiatePayment(user, id);
  }

  @Post(':id/confirm-receipt')
  @UseGuards(JwtAuthGuard)
  confirmReceipt(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ConfirmReceiptDto,
  ) {
    return this.invoicesService.confirmReceipt(user, id, dto);
  }
}
