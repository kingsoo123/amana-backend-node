import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/user.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdatePartnerWebhookDto } from './dto/create-api-key.dto';
import { CreatePartnerAccessRequestDto } from './dto/create-partner-access-request.dto';
import type { WebhookDeliveryStatus } from './partner-webhook-delivery.entity';
import { PartnersService } from './partners.service';
import { WebhooksService } from './webhooks.service';

@Controller('api/v1/me/partner-access')
@UseGuards(JwtAuthGuard)
export class SellerPartnerAccessController {
  constructor(
    private readonly partnersService: PartnersService,
    private readonly webhooksService: WebhooksService,
  ) {}

  @Get()
  getStatus(@CurrentUser() user: User) {
    return this.partnersService.getSellerPartnerAccess(user);
  }

  @Post('request')
  submitRequest(
    @CurrentUser() user: User,
    @Body() dto: CreatePartnerAccessRequestDto,
  ) {
    return this.partnersService.submitAccessRequest(user, dto);
  }

  @Patch('webhook')
  async updateWebhook(
    @CurrentUser() user: User,
    @Body() dto: UpdatePartnerWebhookDto,
  ) {
    const access = await this.partnersService.getSellerPartnerAccess(user);
    if (!access.data.partner) {
      throw new BadRequestException(
        'Partner access has not been approved yet',
      );
    }
    return this.partnersService.updateWebhook(access.data.partner.id, dto);
  }

  @Get('webhook-deliveries')
  async listWebhookDeliveries(
    @CurrentUser() user: User,
    @Query('status') status?: WebhookDeliveryStatus,
    @Query('limit') limit?: string,
  ) {
    const access = await this.partnersService.getSellerPartnerAccess(user);
    if (!access.data.partner) {
      throw new BadRequestException(
        'Partner access has not been approved yet',
      );
    }
    return this.webhooksService.listDeliveries({
      partnerId: access.data.partner.id,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('webhook-deliveries/:deliveryId/retry')
  async retryWebhookDelivery(
    @CurrentUser() user: User,
    @Param('deliveryId') deliveryId: string,
  ) {
    const access = await this.partnersService.getSellerPartnerAccess(user);
    if (!access.data.partner) {
      throw new BadRequestException(
        'Partner access has not been approved yet',
      );
    }
    return this.webhooksService.retryDelivery(
      deliveryId,
      access.data.partner.id,
    );
  }

  @Post('api-keys')
  async createApiKey(@CurrentUser() user: User, @Body() dto: CreateApiKeyDto) {
    const access = await this.partnersService.getSellerPartnerAccess(user);
    if (!access.data.partner) {
      throw new BadRequestException(
        'Partner access has not been approved yet',
      );
    }
    return this.partnersService.createApiKey(access.data.partner.id, dto);
  }

  @Post('api-keys/:keyId/revoke')
  async revokeApiKey(@CurrentUser() user: User, @Param('keyId') keyId: string) {
    const access = await this.partnersService.getSellerPartnerAccess(user);
    if (!access.data.partner) {
      throw new BadRequestException(
        'Partner access has not been approved yet',
      );
    }
    return this.partnersService.revokeApiKey(access.data.partner.id, keyId);
  }
}
