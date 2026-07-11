import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateDisputeDto } from '../disputes/dto/create-dispute.dto';
import { DisputesService } from '../disputes/disputes.service';
import { Invoice } from '../invoices/invoice.entity';
import { InvoicesService } from '../invoices/invoices.service';
import { UsersService } from '../users/users.service';
import { ConfirmTransactionDto } from './dto/confirm-transaction.dto';
import { CreatePartnerDisputeDto } from './dto/create-partner-dispute.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
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

    const externalReference =
      dto.externalReference?.trim() ||
      (typeof dto.metadata?.orderId === 'string'
        ? dto.metadata.orderId
        : null);

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
    };
  }

  async get(partner: Partner, transactionId: string) {
    const invoice = await this.findPartnerInvoice(partner, transactionId);
    const openDispute = await this.disputesService.findOpenByInvoiceId(
      invoice.id,
    );

    return {
      data: this.toResponse(invoice, openDispute),
    };
  }

  async confirm(
    partner: Partner,
    transactionId: string,
    dto: ConfirmTransactionDto,
  ) {
    const invoice = await this.findPartnerInvoice(partner, transactionId);

    const updated = await this.invoicesService.confirmReceiptByEmail(
      invoice.id,
      dto.confirmedBy,
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
