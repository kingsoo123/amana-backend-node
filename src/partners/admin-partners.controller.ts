import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/user.entity';
import {
  CreateApiKeyDto,
  UpdatePartnerWebhookDto,
} from './dto/create-api-key.dto';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { ReviewPartnerAccessRequestDto } from './dto/review-partner-access-request.dto';
import { PartnersService } from './partners.service';

@Controller('api/v1/admin/partners')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Post()
  create(@Body() dto: CreatePartnerDto) {
    return this.partnersService.createPartner(dto);
  }

  @Get()
  list() {
    return this.partnersService.listPartners();
  }

  @Get('access-requests')
  listAccessRequests(@Query('status') status?: string) {
    return this.partnersService.listAccessRequests(status);
  }

  @Post('access-requests/:id/approve')
  approveAccessRequest(
    @CurrentUser() admin: User,
    @Param('id') id: string,
    @Body() dto: ReviewPartnerAccessRequestDto,
  ) {
    return this.partnersService.approveAccessRequest(admin, id, dto);
  }

  @Post('access-requests/:id/reject')
  rejectAccessRequest(
    @CurrentUser() admin: User,
    @Param('id') id: string,
    @Body() dto: ReviewPartnerAccessRequestDto,
  ) {
    return this.partnersService.rejectAccessRequest(admin, id, dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.partnersService.getPartnerOrThrow(id).then((partner) => ({
      data: {
        id: partner.id,
        name: partner.name,
        status: partner.status,
        sellerId: partner.sellerId,
        webhookUrl: partner.webhookUrl,
        hasWebhookSecret: Boolean(partner.webhookSecret),
        createdAt: partner.createdAt,
      },
    }));
  }

  @Patch(':id/webhook')
  updateWebhook(
    @Param('id') id: string,
    @Body() dto: UpdatePartnerWebhookDto,
  ) {
    return this.partnersService.updateWebhook(id, dto);
  }

  @Post(':id/api-keys')
  createApiKey(@Param('id') id: string, @Body() dto: CreateApiKeyDto) {
    return this.partnersService.createApiKey(id, dto);
  }

  @Get(':id/api-keys')
  listApiKeys(@Param('id') id: string) {
    return this.partnersService.listApiKeys(id);
  }

  @Post(':id/api-keys/:keyId/revoke')
  revokeApiKey(@Param('id') id: string, @Param('keyId') keyId: string) {
    return this.partnersService.revokeApiKey(id, keyId);
  }
}
