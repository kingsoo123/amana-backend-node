import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/user.entity';
import { Dispute } from './dispute.entity';
import {
  canBuyerOpenDispute,
  computeDisputeDeadlines,
  DISPUTE_POLICY_STEPS,
  getBuyerDisputeDeadline,
  serializeDeadline,
} from './dispute-policy';
import { AdminResolveDisputeDto } from './dto/admin-resolve-dispute.dto';
import { CreateDisputeDto } from './dto/create-dispute.dto';

@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputesRepository: Repository<Dispute>,
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createForInvoice(user: User, invoiceId: string, dto: CreateDisputeDto) {
    const invoice = await this.invoicesRepository.findOne({
      where: { id: invoiceId },
      relations: { seller: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.buyerEmail.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('Only the buyer can open a dispute');
    }

    if (invoice.status !== 'paid_in_escrow') {
      throw new BadRequestException(
        'Disputes can only be opened while payment is held in escrow',
      );
    }

    if (!canBuyerOpenDispute(invoice.status, invoice.escrowedAt)) {
      throw new BadRequestException(
        'The 48-hour window to raise a dispute after delivery has passed',
      );
    }

    const existing = await this.disputesRepository.findOne({
      where: { invoiceId },
    });

    if (existing && !this.isTerminal(existing.status)) {
      throw new BadRequestException('A dispute is already open for this invoice');
    }

    const openedAt = new Date();
    const deadlines = computeDisputeDeadlines(openedAt);

    const dispute = await this.disputesRepository.save({
      invoiceId: invoice.id,
      raisedByUserId: user.id,
      reason: dto.reason,
      description: dto.description.trim(),
      status: 'open',
      sellerResponseDueAt: deadlines.sellerResponseDueAt,
      platformReviewDueAt: deadlines.platformReviewDueAt,
      decisionDueAt: deadlines.decisionDueAt,
    });

    invoice.status = 'disputed';
    await this.invoicesRepository.save(invoice);

    await this.notificationsService.notifyDisputeOpened(dispute, invoice);

    return {
      message:
        'Dispute opened. The seller has 24 hours to respond. Amana will review within 72 hours and issue a decision within 5 business days.',
      data: await this.findDisputeOrThrow(dispute.id),
    };
  }

  async getInvoiceDisputeContext(invoice: Invoice) {
    const buyerDisputeDeadline = getBuyerDisputeDeadline(invoice.escrowedAt);
    const openDispute = await this.findOpenByInvoiceId(invoice.id);

    return {
      disputePolicy: DISPUTE_POLICY_STEPS,
      buyerDisputeDeadline: serializeDeadline(buyerDisputeDeadline),
      canOpenDispute: canBuyerOpenDispute(invoice.status, invoice.escrowedAt),
      openDispute: openDispute ? this.toResponse(openDispute) : null,
    };
  }

  async listForUser(user: User) {
    const disputes = await this.disputesRepository
      .createQueryBuilder('dispute')
      .leftJoinAndSelect('dispute.invoice', 'invoice')
      .leftJoinAndSelect('invoice.seller', 'seller')
      .where('dispute.raised_by_user_id = :userId', { userId: user.id })
      .orderBy('dispute.created_at', 'DESC')
      .getMany();

    return {
      data: disputes.map((dispute) => this.toResponse(dispute)),
    };
  }

  async getForUser(user: User, disputeId: string) {
    const dispute = await this.findDisputeOrThrow(disputeId);
    this.assertDisputeAccess(user, dispute);
    return { data: this.toResponse(dispute) };
  }

  async listAll(status?: string) {
    const qb = this.disputesRepository
      .createQueryBuilder('dispute')
      .leftJoinAndSelect('dispute.invoice', 'invoice')
      .leftJoinAndSelect('invoice.seller', 'seller')
      .leftJoinAndSelect('dispute.raisedBy', 'raisedBy')
      .orderBy('dispute.created_at', 'DESC');

    if (status) {
      qb.andWhere('dispute.status = :status', { status });
    }

    const disputes = await qb.getMany();
    return { data: disputes.map((dispute) => this.toAdminResponse(dispute)) };
  }

  async adminResolve(
    admin: User,
    disputeId: string,
    dto: AdminResolveDisputeDto,
  ) {
    const dispute = await this.findDisputeOrThrow(disputeId);
    const invoice = dispute.invoice;

    if (!invoice) {
      throw new NotFoundException('Invoice not found for this dispute');
    }

    if (this.isTerminal(dispute.status)) {
      throw new BadRequestException('This dispute has already been resolved');
    }

    const now = new Date();
    dispute.status = dto.status;
    dispute.resolutionNotes = dto.resolutionNotes?.trim() || null;
    dispute.resolvedByAdminId = admin.id;
    dispute.resolvedAt =
      dto.status === 'under_review' ? dispute.resolvedAt : now;

    if (dto.status === 'resolved_seller') {
      invoice.status = 'released';
      invoice.releasedAt = now;
      invoice.paidAt = now;
      invoice.buyerConfirmedAt = invoice.buyerConfirmedAt ?? now;
    } else if (dto.status === 'resolved_buyer') {
      invoice.status = 'cancelled';
    } else if (dto.status === 'closed') {
      invoice.status = 'paid_in_escrow';
    }

    await this.invoicesRepository.save(invoice);
    await this.disputesRepository.save(dispute);

    if (dto.status !== 'under_review') {
      await this.notificationsService.notifyDisputeResolved(
        invoice,
        invoice.seller,
        dto.status,
      );
    }

    return {
      message: 'Dispute updated successfully',
      data: this.toAdminResponse(await this.findDisputeOrThrow(disputeId)),
    };
  }

  async findDisputeOrThrow(disputeId: string) {
    const dispute = await this.disputesRepository.findOne({
      where: { id: disputeId },
      relations: { invoice: { seller: true }, raisedBy: true, resolvedByAdmin: true },
    });

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    return dispute;
  }

  async findOpenByInvoiceId(invoiceId: string) {
    const dispute = await this.disputesRepository.findOne({
      where: { invoiceId },
      order: { createdAt: 'DESC' },
    });

    if (!dispute || this.isTerminal(dispute.status)) {
      return null;
    }

    return dispute;
  }

  private assertDisputeAccess(user: User, dispute: Dispute) {
    const isBuyer = dispute.raisedByUserId === user.id;
    const isSeller =
      dispute.invoice?.sellerId === user.id ||
      dispute.invoice?.seller?.id === user.id;

    if (!isBuyer && !isSeller && user.role !== 'admin') {
      throw new ForbiddenException('You do not have access to this dispute');
    }
  }

  private isTerminal(status: Dispute['status']) {
    return (
      status === 'resolved_buyer' ||
      status === 'resolved_seller' ||
      status === 'closed'
    );
  }

  private toDeadlineResponse(dispute: Dispute) {
    const openedAt = dispute.createdAt;
    const computed = computeDisputeDeadlines(openedAt);

    return {
      sellerResponseDueAt: serializeDeadline(
        dispute.sellerResponseDueAt ?? computed.sellerResponseDueAt,
      ),
      platformReviewDueAt: serializeDeadline(
        dispute.platformReviewDueAt ?? computed.platformReviewDueAt,
      ),
      decisionDueAt: serializeDeadline(dispute.decisionDueAt ?? computed.decisionDueAt),
    };
  }

  private toResponse(dispute: Dispute) {
    const invoice = dispute.invoice;
    const seller = invoice?.seller;

    return {
      id: dispute.id,
      invoiceId: dispute.invoiceId,
      reason: dispute.reason,
      description: dispute.description,
      status: dispute.status,
      resolutionNotes: dispute.resolutionNotes,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
      resolvedAt: dispute.resolvedAt,
      deadlines: this.toDeadlineResponse(dispute),
      invoice: invoice
        ? {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            amount: Number(invoice.amount),
            currency: invoice.currency,
            status: invoice.status,
            buyerEmail: invoice.buyerEmail,
            buyerName: invoice.buyerName,
            seller: seller
              ? {
                  id: seller.id,
                  name: `${seller.firstname} ${seller.lastname}`.trim(),
                  email: seller.email,
                }
              : null,
          }
        : null,
    };
  }

  private toAdminResponse(dispute: Dispute) {
    const base = this.toResponse(dispute);
    const raisedBy = dispute.raisedBy;

    return {
      ...base,
      raisedBy: raisedBy
        ? {
            id: raisedBy.id,
            name: `${raisedBy.firstname} ${raisedBy.lastname}`.trim(),
            email: raisedBy.email,
          }
        : null,
      resolvedByAdmin: dispute.resolvedByAdmin
        ? {
            id: dispute.resolvedByAdmin.id,
            name: `${dispute.resolvedByAdmin.firstname} ${dispute.resolvedByAdmin.lastname}`.trim(),
            email: dispute.resolvedByAdmin.email,
          }
        : null,
    };
  }
}
