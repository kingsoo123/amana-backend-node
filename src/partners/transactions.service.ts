import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CreateDisputeDto } from '../disputes/dto/create-dispute.dto';
import { DisputesService } from '../disputes/disputes.service';
import { Invoice } from '../invoices/invoice.entity';
import { InvoicesService } from '../invoices/invoices.service';
import { UsersService } from '../users/users.service';
import { ConfirmTransactionDto } from './dto/confirm-transaction.dto';
import { CreatePartnerDisputeDto } from './dto/create-partner-dispute.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { CreateDisputeMessageDto } from '../disputes/dto/create-dispute-message.dto';
import { SignDisputeUploadDto } from '../disputes/dto/sign-dispute-upload.dto';
import { Partner } from './partner.entity';
import { toPartnerTransaction } from './transaction-mapper';
import { WebhooksService } from './webhooks.service';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    private readonly invoicesService: InvoicesService,
    private readonly disputesService: DisputesService,
    private readonly usersService: UsersService,
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
  ) {}

  async create(partner: Partner, dto: CreateTransactionDto) {
    if (dto.currency && dto.currency.toUpperCase() !== 'NGN') {
      throw new BadRequestException('Only NGN is supported in this preview');
    }

    const seller =
      partner.seller ?? (await this.usersService.findById(partner.sellerId));

    if (!seller) {
      throw new NotFoundException('Partner seller account not found');
    }

    const externalReference = this.resolveExternalReference(dto);

    if (externalReference) {
      const existing = await this.invoicesRepository.findOne({
        where: {
          partnerId: partner.id,
          externalReference,
        },
      });

      if (existing) {
        this.assertIdempotentCreateMatches(existing, dto);
        return {
          data: this.toResponse(existing),
          meta: {
            idempotentReplay: true,
            externalReference,
          },
        };
      }
    }

    try {
      const created = await this.invoicesService.createInvoice(
        seller,
        {
          buyerEmail: dto.buyer.email,
          buyerName: dto.buyer.name,
          amount: dto.amount,
          description: dto.description,
        },
        {
          partnerId: partner.id,
          externalReference,
          metadata: dto.metadata ?? null,
          successUrl: dto.successUrl ?? null,
          cancelUrl: dto.cancelUrl ?? null,
        },
      );

      const invoice = await this.invoicesRepository.findOne({
        where: { id: created.data.id },
      });

      if (!invoice) {
        throw new NotFoundException('Transaction not found after create');
      }

      await this.webhooksService.emitInvoiceEvent('transaction.created', invoice);

      return {
        data: this.toResponse(invoice),
        meta: {
          idempotentReplay: false,
          externalReference: invoice.externalReference,
        },
      };
    } catch (error) {
      if (!externalReference || !this.isUniqueViolation(error)) {
        throw error;
      }

      const existing = await this.invoicesRepository.findOne({
        where: {
          partnerId: partner.id,
          externalReference,
        },
      });

      if (!existing) {
        throw error;
      }

      this.assertIdempotentCreateMatches(existing, dto);
      return {
        data: this.toResponse(existing),
        meta: {
          idempotentReplay: true,
          externalReference,
        },
      };
    }
  }

  private resolveExternalReference(dto: CreateTransactionDto): string | null {
    const fromField = dto.externalReference?.trim();
    if (fromField) {
      return fromField;
    }

    const orderId = dto.metadata?.orderId;
    if (typeof orderId === 'string' && orderId.trim()) {
      return orderId.trim();
    }

    return null;
  }

  private assertIdempotentCreateMatches(
    existing: Invoice,
    dto: CreateTransactionDto,
  ) {
    const amountMatches =
      Math.abs(Number(existing.amount) - Number(dto.amount)) < 0.009;
    const buyerMatches =
      existing.buyerEmail.toLowerCase() === dto.buyer.email.trim().toLowerCase();
    const currency = (dto.currency ?? 'NGN').toUpperCase();
    const currencyMatches =
      (existing.currency || 'NGN').toUpperCase() === currency;

    if (!amountMatches || !buyerMatches || !currencyMatches) {
      throw new ConflictException(
        `externalReference “${existing.externalReference}” already exists for a different transaction (amount/buyer/currency mismatch). Use a new externalReference or GET the existing transaction id ${existing.id}.`,
      );
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string } | undefined;
    return driverError?.code === '23505';
  }

  async get(partner: Partner, transactionId: string) {
    let invoice = await this.findPartnerInvoice(partner, transactionId);
    invoice = await this.invoicesService.ensureDeliveryOtpPersisted(invoice);
    const openDispute = await this.disputesService.findOpenByInvoiceId(
      invoice.id,
    );

    return {
      data: this.toResponse(invoice, openDispute),
    };
  }

  async getDeliveryOtp(partner: Partner, transactionId: string) {
    let invoice = await this.findPartnerInvoice(partner, transactionId);
    invoice = await this.invoicesService.ensureDeliveryOtpPersisted(invoice);

    const requiresDeliveryOtp =
      invoice.status === 'paid_in_escrow' || invoice.status === 'disputed';

    if (!requiresDeliveryOtp || !invoice.deliveryOtpCode) {
      throw new BadRequestException(
        'Delivery OTP is not available for this transaction. Funds must be in escrow (and not yet confirmed).',
      );
    }

    return {
      data: {
        transactionId: invoice.id,
        reference: invoice.invoiceNumber,
        status: invoice.status,
        requiresDeliveryOtp: true,
        deliveryOtp: invoice.deliveryOtpCode,
      },
    };
  }

  async confirm(
    partner: Partner,
    transactionId: string,
    dto: ConfirmTransactionDto,
  ) {
    let invoice = await this.findPartnerInvoice(partner, transactionId);
    invoice = await this.invoicesService.ensureDeliveryOtpPersisted(invoice);

    const updated = await this.invoicesService.confirmReceiptByEmail(
      invoice.id,
      dto.confirmedBy,
      {
        deliveryOtp: dto.deliveryOtp,
        latitude: dto.latitude,
        longitude: dto.longitude,
        locationAccuracy: dto.locationAccuracy,
      },
    );

    const refreshed = await this.findPartnerInvoice(partner, updated.data.id);

    return {
      message: updated.message,
      data: this.toResponse(refreshed),
    };
  }

  async openDispute(
    partner: Partner,
    transactionId: string,
    dto: CreatePartnerDisputeDto,
  ) {
    const invoice = await this.findPartnerInvoice(partner, transactionId);
    const raisedByEmail = (
      dto.raisedByEmail ?? invoice.buyerEmail
    ).trim().toLowerCase();

    if (raisedByEmail !== invoice.buyerEmail.toLowerCase()) {
      throw new ForbiddenException(
        'raisedByEmail must match the transaction buyer',
      );
    }

    const disputeDto: CreateDisputeDto = {
      reason: dto.reason,
      description: dto.description,
      latitude: dto.latitude,
      longitude: dto.longitude,
      locationAccuracy: dto.locationAccuracy,
    };

    const result = await this.disputesService.createForInvoiceByEmail(
      raisedByEmail,
      invoice.id,
      disputeDto,
    );

    const refreshed = await this.findPartnerInvoice(partner, transactionId);

    return {
      message: result.message,
      data: {
        dispute: {
          id: result.data.id,
          transactionId: invoice.id,
          status: result.data.status,
          reason: result.data.reason,
        },
        transaction: this.toResponse(refreshed),
      },
    };
  }

  async listDisputeMessages(
    partner: Partner,
    transactionId: string,
    disputeId: string,
  ) {
    await this.assertPartnerDispute(partner, transactionId, disputeId);
    return this.disputesService.listMessagesForPartner(partner, disputeId);
  }

  async postDisputeMessage(
    partner: Partner,
    transactionId: string,
    disputeId: string,
    dto: CreateDisputeMessageDto,
  ) {
    await this.assertPartnerDispute(partner, transactionId, disputeId);
    return this.disputesService.postMessageForPartner(partner, disputeId, dto);
  }

  async signDisputeUpload(
    partner: Partner,
    transactionId: string,
    disputeId: string,
    dto: SignDisputeUploadDto,
  ) {
    await this.assertPartnerDispute(partner, transactionId, disputeId);
    return this.disputesService.signUploadForPartner(partner, disputeId, dto);
  }

  private async assertPartnerDispute(
    partner: Partner,
    transactionId: string,
    disputeId: string,
  ) {
    const invoice = await this.findPartnerInvoice(partner, transactionId);
    const dispute = await this.disputesService.findDisputeOrThrow(disputeId);
    if (dispute.invoiceId !== invoice.id) {
      throw new ForbiddenException(
        'Dispute does not belong to this transaction',
      );
    }
    return dispute;
  }

  private async findPartnerInvoice(partner: Partner, transactionId: string) {
    const invoice = await this.invoicesRepository.findOne({
      where: { id: transactionId },
      relations: { seller: true },
    });

    if (!invoice) {
      throw new NotFoundException('Transaction not found');
    }

    if (invoice.partnerId !== partner.id) {
      throw new ForbiddenException('Transaction does not belong to this partner');
    }

    if (invoice.sellerId !== partner.sellerId) {
      throw new ForbiddenException('Transaction seller mismatch');
    }

    return invoice;
  }

  private toResponse(invoice: Invoice, dispute?: { id: string } | null) {
    return toPartnerTransaction(invoice, {
      frontendBaseUrl: this.resolveFrontendBaseUrl(),
      dispute: dispute as never,
    });
  }

  private resolveFrontendBaseUrl() {
    const raw =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    return raw.split(',')[0]?.trim() || 'http://localhost:3000';
  }
}
