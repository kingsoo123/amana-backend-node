import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { AccountsService } from './accounts.service';
import { ConfirmBvnDto } from './dto/confirm-bvn.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { InitiateBvnDto } from './dto/initiate-bvn.dto';

@Controller()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get('api/v1/account/status')
  @UseGuards(JwtAuthGuard)
  getAccountStatus(@CurrentUser() user: User) {
    return this.accountsService.getAccountStatus(user);
  }

  @Post('api/v1/bvn/initiate')
  @UseGuards(JwtAuthGuard)
  initiateBvn(@CurrentUser() user: User, @Body() dto: InitiateBvnDto) {
    return this.accountsService.initiateBvnVerification(user, dto);
  }

  @Post('api/v1/bvn/confirm')
  @UseGuards(JwtAuthGuard)
  confirmBvn(@CurrentUser() user: User, @Body() dto: ConfirmBvnDto) {
    return this.accountsService.confirmBvnVerification(user, dto);
  }

  @Post('api/v1/dva/create')
  @UseGuards(JwtAuthGuard)
  createDva(
    @CurrentUser() user: User,
    @Body() dto: CreateAccountDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    return this.accountsService.createVirtualAccount(
      user,
      dto,
      idempotencyKey?.trim() || undefined,
    );
  }

  @Post('create-account')
  @UseGuards(JwtAuthGuard)
  createAccount(
    @CurrentUser() user: User,
    @Body() dto: CreateAccountDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    return this.accountsService.createVirtualAccount(
      user,
      dto,
      idempotencyKey?.trim() || undefined,
    );
  }
}
