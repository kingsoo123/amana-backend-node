import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerWebhookDto } from './dto/create-api-key.dto';
import { CreatePartnerAccessRequestDto } from './dto/create-partner-access-request.dto';
import { ReviewPartnerAccessRequestDto } from './dto/review-partner-access-request.dto';
import { PartnerAccessRequest } from './partner-access-request.entity';
import { PartnerApiKey } from './partner-api-key.entity';
import { Partner } from './partner.entity';
import { Invoice } from '../invoices/invoice.entity';

@Injectable()
export class PartnersService {
  constructor(
    @InjectRepository(Partner)
    private readonly partnersRepository: Repository<Partner>,
    @InjectRepository(PartnerApiKey)
    private readonly apiKeysRepository: Repository<PartnerApiKey>,
    @InjectRepository(PartnerAccessRequest)
    private readonly accessRequestsRepository: Repository<PartnerAccessRequest>,
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createPartner(dto: CreatePartnerDto) {
    let seller = await this.usersService.findById(dto.sellerId);
    if (!seller) {
      throw new NotFoundException('Seller user not found');
    }
    if (seller.role === 'admin') {
      throw new BadRequestException(
        'Admin accounts cannot be partner sellers. Use a seller account instead.',
      );
    }
    if (seller.role !== 'seller') {
      seller = await this.usersService.promoteToSeller(seller);
    }

    const existing = await this.partnersRepository.findOne({
      where: { sellerId: seller.id },
      order: { createdAt: 'DESC' },
    });
    if (existing?.status === 'active') {
      throw new BadRequestException(
        'This seller already has an active partner account',
      );
    }
    if (existing?.status === 'disabled') {
      throw new BadRequestException(
        'This seller already has a partner account that is disabled. Re-enable it instead of creating another.',
      );
    }

    const webhookSecret = randomBytes(32).toString('hex');

    const partner = await this.partnersRepository.save({
      name: dto.name.trim(),
      sellerId: seller.id,
      webhookUrl: dto.webhookUrl?.trim() || null,
      webhookSecret,
      status: 'active',
    });

    return {
      data: this.toPartnerResponse(partner),
      webhookSecret,
      message:
        'Partner created. Store webhookSecret securely — it is only shown once.',
    };
  }

  async listPartners() {
    const partners = await this.partnersRepository.find({
      order: { createdAt: 'DESC' },
      relations: { seller: true },
    });

    return {
      data: partners.map((partner) => this.toPartnerResponse(partner)),
    };
  }

  async getPartnerOrThrow(partnerId: string) {
    const partner = await this.partnersRepository.findOne({
      where: { id: partnerId },
      relations: { seller: true },
    });

    if (!partner) {
      throw new NotFoundException('Partner not found');
    }

    return partner;
  }

  async findPartnerBySellerId(sellerId: string) {
    const active = await this.partnersRepository.findOne({
      where: { sellerId, status: 'active' },
      relations: { seller: true },
    });
    if (active) {
      return active;
    }

    return this.partnersRepository.findOne({
      where: { sellerId, status: 'disabled' },
      relations: { seller: true },
      order: { updatedAt: 'DESC' },
    });
  }

  async updatePartnerStatus(partnerId: string, status: 'active' | 'disabled') {
    const partner = await this.getPartnerOrThrow(partnerId);

    if (partner.status === status) {
      return {
        message:
          status === 'active'
            ? 'Partner is already active'
            : 'Partner is already disabled',
        data: this.toPartnerResponse(partner),
      };
    }

    if (status === 'active') {
      const otherActive = await this.partnersRepository.findOne({
        where: { sellerId: partner.sellerId, status: 'active' },
      });
      if (otherActive && otherActive.id !== partner.id) {
        throw new BadRequestException(
          'Another active partner already exists for this seller',
        );
      }
    }

    partner.status = status;
    await this.partnersRepository.save(partner);

    const refreshed = await this.getPartnerOrThrow(partnerId);
    return {
      message:
        status === 'active'
          ? 'Partner enabled. API keys can authenticate again.'
          : 'Partner disabled. API requests will be rejected until re-enabled.',
      data: this.toPartnerResponse(refreshed),
    };
  }

  async updateWebhook(partnerId: string, dto: UpdatePartnerWebhookDto) {
    const partner = await this.getPartnerOrThrow(partnerId);
    partner.webhookUrl = dto.webhookUrl.trim();
    if (dto.webhookSecret) {
      partner.webhookSecret = dto.webhookSecret;
    } else if (!partner.webhookSecret) {
      partner.webhookSecret = randomBytes(32).toString('hex');
    }
    await this.partnersRepository.save(partner);

    return {
      data: this.toPartnerResponse(partner),
      webhookSecret: dto.webhookSecret ? undefined : partner.webhookSecret,
    };
  }

  async createApiKey(partnerId: string, dto: CreateApiKeyDto) {
    const partner = await this.getPartnerOrThrow(partnerId);
    if (partner.status !== 'active') {
      throw new BadRequestException(
        'Cannot create API keys while the partner is disabled. Re-enable it first.',
      );
    }

    const rawSecret = randomBytes(24).toString('hex');
    const fullKey = `ak_live_${rawSecret}`;
    const keyPrefix = fullKey.slice(0, 16);
    const keyHash = this.hashApiKey(fullKey);

    const record = await this.apiKeysRepository.save({
      partnerId,
      name: dto.name.trim(),
      keyPrefix,
      keyHash,
    });

    return {
      data: {
        id: record.id,
        name: record.name,
        keyPrefix: record.keyPrefix,
        createdAt: record.createdAt,
      },
      apiKey: fullKey,
      message:
        'API key created. Store it securely — the full key is only shown once.',
    };
  }

  async listApiKeys(partnerId: string) {
    await this.getPartnerOrThrow(partnerId);

    const keys = await this.apiKeysRepository.find({
      where: { partnerId },
      order: { createdAt: 'DESC' },
    });

    return {
      data: keys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
        createdAt: key.createdAt,
      })),
    };
  }

  async revokeApiKey(partnerId: string, keyId: string) {
    const key = await this.apiKeysRepository.findOne({
      where: { id: keyId, partnerId },
    });

    if (!key) {
      throw new NotFoundException('API key not found');
    }

    if (key.revokedAt) {
      throw new BadRequestException('API key is already revoked');
    }

    key.revokedAt = new Date();
    await this.apiKeysRepository.save(key);

    return { message: 'API key revoked' };
  }

  async getSellerPartnerAccess(seller: User) {
    if (seller.role === 'admin') {
      throw new ForbiddenException(
        'Admins manage partners via /api/v1/admin/partners',
      );
    }

    const verified = await this.usersService.isVerified(seller.id);
    let actor = seller;

    // Backfill: existing partners / invoice sellers become role=seller.
    if (actor.role !== 'seller') {
      const partnerCount = await this.partnersRepository.count({
        where: { sellerId: actor.id },
      });
      const invoiceCount = await this.invoicesRepository.count({
        where: { sellerId: actor.id },
      });
      if (partnerCount > 0 || invoiceCount > 0) {
        actor = await this.usersService.promoteToSeller(actor);
      }
    }

    const partner = await this.findPartnerBySellerId(actor.id);
    const latestRequest = await this.accessRequestsRepository.findOne({
      where: { sellerId: actor.id },
      order: { createdAt: 'DESC' },
    });

    let apiKeys: Awaited<ReturnType<PartnersService['listApiKeys']>>['data'] =
      [];
    if (partner) {
      apiKeys = (await this.listApiKeys(partner.id)).data;
    }

    const hasPartnerRecord = Boolean(partner);
    const isSeller = actor.role === 'seller';

    return {
      data: {
        verified,
        isSeller,
        canBecomeSeller: verified && !isSeller && actor.role === 'user',
        canRequest:
          verified &&
          isSeller &&
          !hasPartnerRecord &&
          latestRequest?.status !== 'pending',
        partner: partner ? this.toPartnerResponse(partner) : null,
        apiKeys,
        request: latestRequest
          ? this.toAccessRequestResponse(latestRequest)
          : null,
      },
    };
  }

  async enableSellerTools(user: User) {
    if (user.role === 'admin') {
      throw new ForbiddenException(
        'Admin accounts cannot enable seller tools',
      );
    }

    const verified = await this.usersService.isVerified(user.id);
    if (!verified) {
      throw new ForbiddenException(
        'Complete verification and create a virtual account before enabling seller tools',
      );
    }

    const seller = await this.usersService.promoteToSeller(user);
    return {
      message: 'Seller tools enabled. You can now request partner API access.',
      data: {
        id: seller.id,
        role: seller.role,
        verified: true,
      },
    };
  }

  async submitAccessRequest(seller: User, dto: CreatePartnerAccessRequestDto) {
    this.usersService.assertSellerRole(seller);

    const verified = await this.usersService.isVerified(seller.id);
    if (!verified) {
      throw new ForbiddenException(
        'Complete verification and create a virtual account before requesting partner API access',
      );
    }

    const existingPartner = await this.partnersRepository.findOne({
      where: { sellerId: seller.id },
      order: { createdAt: 'DESC' },
    });
    if (existingPartner?.status === 'active') {
      throw new BadRequestException('You already have partner API access');
    }
    if (existingPartner?.status === 'disabled') {
      throw new BadRequestException(
        'Your partner access is disabled. Contact Amana ops to re-enable it.',
      );
    }

    const pending = await this.accessRequestsRepository.findOne({
      where: { sellerId: seller.id, status: 'pending' },
    });
    if (pending) {
      throw new BadRequestException(
        'You already have a pending partner access request',
      );
    }

    const request = await this.accessRequestsRepository.save({
      sellerId: seller.id,
      businessName: dto.businessName.trim(),
      webhookUrl: dto.webhookUrl?.trim() || null,
      notes: dto.notes?.trim() || null,
      status: 'pending',
    });

    await this.notificationsService.notifyPartnerAccessRequested(
      request,
      seller,
    );

    return {
      message:
        'Partner access request submitted. Amana admins will review it shortly.',
      data: this.toAccessRequestResponse(request),
    };
  }

  async listAccessRequests(status?: string) {
    const qb = this.accessRequestsRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.seller', 'seller')
      .leftJoinAndSelect('request.reviewedByAdmin', 'reviewedByAdmin')
      .leftJoinAndSelect('request.partner', 'partner')
      .orderBy('request.created_at', 'DESC');

    if (status) {
      qb.andWhere('request.status = :status', { status });
    }

    const requests = await qb.getMany();
    return {
      data: requests.map((request) =>
        this.toAccessRequestAdminResponse(request),
      ),
    };
  }

  async approveAccessRequest(
    admin: User,
    requestId: string,
    dto: ReviewPartnerAccessRequestDto,
  ) {
    const request = await this.findAccessRequestOrThrow(requestId);

    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed');
    }

    const existingPartner = await this.findPartnerBySellerId(request.sellerId);
    if (existingPartner) {
      throw new BadRequestException(
        'This seller already has an active partner account',
      );
    }

    const created = await this.createPartner({
      name: request.businessName,
      sellerId: request.sellerId,
      webhookUrl: request.webhookUrl ?? undefined,
    });

    request.status = 'approved';
    request.reviewedByAdminId = admin.id;
    request.reviewedAt = new Date();
    request.reviewNotes = dto.reviewNotes?.trim() || null;
    request.partnerId = created.data.id;
    await this.accessRequestsRepository.save(request);

    const seller =
      request.seller ?? (await this.usersService.findById(request.sellerId));
    if (seller) {
      await this.notificationsService.notifyPartnerAccessReviewed(
        seller,
        'approved',
        dto.reviewNotes,
      );
    }

    return {
      message:
        'Partner access approved. The seller can now generate API keys from their dashboard.',
      data: {
        request: this.toAccessRequestAdminResponse(
          await this.findAccessRequestOrThrow(requestId),
        ),
        partner: created.data,
        webhookSecret: created.webhookSecret,
      },
    };
  }

  async rejectAccessRequest(
    admin: User,
    requestId: string,
    dto: ReviewPartnerAccessRequestDto,
  ) {
    const request = await this.findAccessRequestOrThrow(requestId);

    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed');
    }

    request.status = 'rejected';
    request.reviewedByAdminId = admin.id;
    request.reviewedAt = new Date();
    request.reviewNotes = dto.reviewNotes?.trim() || null;
    await this.accessRequestsRepository.save(request);

    const seller =
      request.seller ?? (await this.usersService.findById(request.sellerId));
    if (seller) {
      await this.notificationsService.notifyPartnerAccessReviewed(
        seller,
        'rejected',
        dto.reviewNotes,
      );
    }

    return {
      message: 'Partner access request rejected',
      data: this.toAccessRequestAdminResponse(
        await this.findAccessRequestOrThrow(requestId),
      ),
    };
  }

  async authenticateApiKey(apiKey: string): Promise<Partner | null> {
    if (!apiKey.startsWith('ak_live_')) {
      return null;
    }

    const keyPrefix = apiKey.slice(0, 16);
    const record = await this.apiKeysRepository.findOne({
      where: { keyPrefix, revokedAt: IsNull() },
      relations: { partner: { seller: true } },
    });

    if (!record?.partner) {
      return null;
    }

    const incomingHash = this.hashApiKey(apiKey);
    const stored = Buffer.from(record.keyHash, 'hex');
    const incoming = Buffer.from(incomingHash, 'hex');

    if (
      stored.length !== incoming.length ||
      !timingSafeEqual(stored, incoming)
    ) {
      return null;
    }

    record.lastUsedAt = new Date();
    await this.apiKeysRepository.save(record);

    return record.partner;
  }

  private async findAccessRequestOrThrow(requestId: string) {
    const request = await this.accessRequestsRepository.findOne({
      where: { id: requestId },
      relations: { seller: true, reviewedByAdmin: true, partner: true },
    });

    if (!request) {
      throw new NotFoundException('Partner access request not found');
    }

    return request;
  }

  private hashApiKey(apiKey: string) {
    return createHash('sha256').update(apiKey).digest('hex');
  }

  private toPartnerResponse(partner: Partner) {
    const seller = partner.seller;

    return {
      id: partner.id,
      name: partner.name,
      status: partner.status,
      sellerId: partner.sellerId,
      webhookUrl: partner.webhookUrl,
      hasWebhookSecret: Boolean(partner.webhookSecret),
      createdAt: partner.createdAt,
      seller: seller
        ? {
            id: seller.id,
            name: `${seller.firstname} ${seller.lastname}`.trim(),
            email: seller.email,
          }
        : null,
    };
  }

  private toAccessRequestResponse(request: PartnerAccessRequest) {
    return {
      id: request.id,
      businessName: request.businessName,
      webhookUrl: request.webhookUrl,
      notes: request.notes,
      status: request.status,
      reviewNotes: request.reviewNotes,
      reviewedAt: request.reviewedAt,
      partnerId: request.partnerId,
      createdAt: request.createdAt,
    };
  }

  private toAccessRequestAdminResponse(request: PartnerAccessRequest) {
    const seller = request.seller;
    const admin = request.reviewedByAdmin;

    return {
      ...this.toAccessRequestResponse(request),
      seller: seller
        ? {
            id: seller.id,
            name: `${seller.firstname} ${seller.lastname}`.trim(),
            email: seller.email,
            verified: seller.verified,
          }
        : null,
      reviewedByAdmin: admin
        ? {
            id: admin.id,
            name: `${admin.firstname} ${admin.lastname}`.trim(),
            email: admin.email,
          }
        : null,
      partner: request.partner
        ? {
            id: request.partner.id,
            name: request.partner.name,
            status: request.partner.status,
          }
        : null,
    };
  }
}
