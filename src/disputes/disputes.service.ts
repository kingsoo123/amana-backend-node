import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { EscrowSettlementService } from '../escrow/escrow-settlement.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../partners/webhooks.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
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
import { CreateDisputeMessageDto } from './dto/create-dispute-message.dto';
import { Partner } from '../partners/partner.entity';
import { CloudinaryService } from '../media/cloudinary.service';
import { SignDisputeUploadDto } from './dto/sign-dispute-upload.dto';
import {
  DisputeMessage,
  DisputeMessageSenderKind,
} from './dispute-message.entity';

@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputesRepository: Repository<Dispute>,
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    @InjectRepository(DisputeMessage)
    private readonly messagesRepository: Repository<DisputeMessage>,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
    private readonly escrowSettlement: EscrowSettlementService,
    private readonly cloudinaryService: CloudinaryService,
    @Optional()
    @Inject(forwardRef(() => WebhooksService))
    private readonly webhooksService?: WebhooksService,
  ) {}

  async createForInvoice(user: User, invoiceId: string, dto: CreateDisputeDto) {
    return this.openDispute({
      invoiceId,
      buyerEmail: user.email,
      raisedByUserId: user.id,
      dto,
    });
  }

  async createForInvoiceByEmail(
    buyerEmail: string,
    invoiceId: string,
    dto: CreateDisputeDto,
  ) {
    const buyer = await this.usersService.findByEmail(buyerEmail);

    return this.openDispute({
      invoiceId,
      buyerEmail,
      raisedByUserId: buyer?.id ?? null,
      dto,
    });
  }

  private async openDispute(input: {
    invoiceId: string;
    buyerEmail: string;
    raisedByUserId: string | null;
    dto: CreateDisputeDto;
  }) {
    const invoice = await this.invoicesRepository.findOne({
      where: { id: input.invoiceId },
      relations: { seller: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.buyerEmail.toLowerCase() !== input.buyerEmail.toLowerCase()) {
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
      where: { invoiceId: input.invoiceId },
    });

    if (existing && !this.isTerminal(existing.status)) {
      throw new BadRequestException('A dispute is already open for this invoice');
    }

    const openedAt = new Date();
    const deadlines = computeDisputeDeadlines(openedAt);

    const dispute = await this.disputesRepository.save({
      invoiceId: invoice.id,
      raisedByUserId: input.raisedByUserId,
      reason: input.dto.reason,
      description: input.dto.description.trim(),
      status: 'open',
      sellerResponseDueAt: deadlines.sellerResponseDueAt,
      platformReviewDueAt: deadlines.platformReviewDueAt,
      decisionDueAt: deadlines.decisionDueAt,
      raisedLatitude: input.dto.latitude ?? null,
      raisedLongitude: input.dto.longitude ?? null,
      raisedLocationAccuracy: input.dto.locationAccuracy ?? null,
    });

    invoice.status = 'disputed';
    await this.invoicesRepository.save(invoice);

    await this.notificationsService.notifyDisputeOpened(dispute, invoice);
    await this.webhooksService?.emitInvoiceEvent('dispute.opened', invoice, {
      disputeId: dispute.id,
      reason: dispute.reason,
    });

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
    const data = await Promise.all(
      disputes.map((dispute) => this.toAdminResponseAsync(dispute)),
    );
    return { data };
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
      await this.escrowSettlement.payoutToSeller(invoice);
      invoice.status = 'released';
      invoice.releasedAt = now;
      if (!invoice.paidAt) {
        invoice.paidAt = invoice.escrowedAt ?? now;
      }
      invoice.buyerConfirmedAt = invoice.buyerConfirmedAt ?? now;
    } else if (dto.status === 'resolved_buyer') {
      await this.escrowSettlement.refundToBuyer(invoice);
      invoice.status = 'cancelled';
    } else if (dto.status === 'closed') {
      invoice.status = 'paid_in_escrow';
    }

    await this.invoicesRepository.save(invoice);
    await this.disputesRepository.save(dispute);

    if (dto.status === 'under_review') {
      await this.webhooksService?.emitInvoiceEvent(
        'dispute.under_review',
        invoice,
        { disputeId: dispute.id },
      );
    } else if (dto.status === 'resolved_seller') {
      await this.webhooksService?.emitInvoiceEvent('dispute.resolved', invoice, {
        disputeId: dispute.id,
        outcome: 'resolved_seller',
      });
      await this.webhooksService?.emitInvoiceEvent('escrow.released', invoice, {
        reason: 'dispute_resolved_seller',
        payoutStatus: invoice.payoutStatus,
      });
    } else if (dto.status === 'resolved_buyer') {
      await this.webhooksService?.emitInvoiceEvent('dispute.resolved', invoice, {
        disputeId: dispute.id,
        outcome: 'resolved_buyer',
      });
      await this.webhooksService?.emitInvoiceEvent(
        invoice.refundStatus === 'completed'
          ? 'refund.completed'
          : 'refund.processing',
        invoice,
        {
          disputeId: dispute.id,
          refundStatus: invoice.refundStatus,
        },
      );
    } else if (dto.status === 'closed') {
      await this.webhooksService?.emitInvoiceEvent('dispute.closed', invoice, {
        disputeId: dispute.id,
      });
    }

    if (dto.status !== 'under_review') {
      await this.notificationsService.notifyDisputeResolved(
        invoice,
        invoice.seller,
        dto.status,
      );
    }

    const refreshed = await this.findDisputeOrThrow(disputeId);
    const refundNote =
      dto.status === 'resolved_buyer'
        ? this.refundMessage(refreshed.invoice?.refundStatus ?? null)
        : null;

    return {
      message: refundNote
        ? `Dispute resolved in buyer’s favour. ${refundNote}`
        : 'Dispute updated successfully',
      data: await this.toAdminResponseAsync(refreshed),
    };
  }

  async adminRetryRefund(admin: User, disputeId: string) {
    const dispute = await this.findDisputeOrThrow(disputeId);
    const invoice = dispute.invoice;

    if (!invoice) {
      throw new NotFoundException('Invoice not found for this dispute');
    }

    if (dispute.status !== 'resolved_buyer') {
      throw new BadRequestException(
        'Refunds can only be retried after resolving the dispute in the buyer’s favour',
      );
    }

    if (
      invoice.refundStatus === 'completed' ||
      invoice.refundStatus === 'not_required'
    ) {
      throw new BadRequestException('This refund is already complete');
    }

    // Allow retry after a failed transfer (or legacy pending_manual rows).
    if (invoice.refundStatus === 'processing') {
      throw new BadRequestException(
        'A refund transfer is already in progress for this invoice',
      );
    }

    invoice.refundStatus = null;
    invoice.refundError = null;
    await this.invoicesRepository.save(invoice);

    const refunded = await this.escrowSettlement.refundToBuyer(invoice);

    dispute.resolvedByAdminId = admin.id;
    await this.disputesRepository.save(dispute);

    await this.webhooksService?.emitInvoiceEvent(
      refunded.refundStatus === 'completed'
        ? 'refund.completed'
        : 'refund.processing',
      refunded,
      {
        disputeId: dispute.id,
        refundStatus: refunded.refundStatus,
        retried: true,
      },
    );

    const refreshed = await this.findDisputeOrThrow(disputeId);
    return {
      message: this.refundMessage(refreshed.invoice?.refundStatus ?? null),
      data: await this.toAdminResponseAsync(refreshed),
    };
  }

  private refundMessage(refundStatus: string | null) {
    if (refundStatus === 'completed' || refundStatus === 'not_required') {
      return 'Refund sent to the buyer’s verified account.';
    }
    if (refundStatus === 'processing') {
      return 'Refund transfer has been queued.';
    }
    if (refundStatus === 'failed') {
      return 'Refund transfer failed. You can retry once the buyer account is ready.';
    }
    return 'Refund status updated.';
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

  async listMessages(user: User, disputeId: string) {
    const dispute = await this.findDisputeOrThrow(disputeId);
    this.assertBuyerOrAdminChatAccess(user, dispute);
    return this.listMessagesInternal(dispute);
  }

  async listMessagesForPartner(partner: Partner, disputeId: string) {
    const dispute = await this.findPartnerDisputeOrThrow(partner, disputeId);
    return this.listMessagesInternal(dispute);
  }

  async postMessage(
    user: User,
    disputeId: string,
    dto: CreateDisputeMessageDto,
  ) {
    const dispute = await this.findDisputeOrThrow(disputeId);
    this.assertBuyerOrAdminChatAccess(user, dispute);

    const senderKind: DisputeMessageSenderKind =
      user.role === 'admin' ? 'admin' : 'buyer';

    return this.createMessage({
      dispute,
      senderKind,
      senderUserId: user.id,
      senderPartnerId: null,
      dto,
      notifyAs: { kind: 'user', user },
    });
  }

  async postMessageForPartner(
    partner: Partner,
    disputeId: string,
    dto: CreateDisputeMessageDto,
  ) {
    const dispute = await this.findPartnerDisputeOrThrow(partner, disputeId);
    return this.createMessage({
      dispute,
      senderKind: 'partner',
      senderUserId: null,
      senderPartnerId: partner.id,
      dto,
      notifyAs: {
        kind: 'partner',
        partnerName: partner.name,
      },
    });
  }

  async signUploadForPartner(
    partner: Partner,
    disputeId: string,
    dto: SignDisputeUploadDto,
  ) {
    const dispute = await this.findPartnerDisputeOrThrow(partner, disputeId);
    if (this.isTerminal(dispute.status)) {
      throw new BadRequestException(
        'This dispute is closed. Uploads are no longer available.',
      );
    }

    return {
      data: this.cloudinaryService.signUpload({
        folder: `amana/disputes/${dispute.id}`,
        resourceType: dto.resourceType ?? 'auto',
      }),
    };
  }

  async signUploadForUser(
    user: User,
    disputeId: string,
    dto: SignDisputeUploadDto,
  ) {
    const dispute = await this.findDisputeOrThrow(disputeId);
    this.assertBuyerOrAdminChatAccess(user, dispute);
    if (this.isTerminal(dispute.status)) {
      throw new BadRequestException(
        'This dispute is closed. Uploads are no longer available.',
      );
    }

    return {
      data: this.cloudinaryService.signUpload({
        folder: `amana/disputes/${dispute.id}`,
        resourceType: dto.resourceType ?? 'auto',
      }),
    };
  }

  private async listMessagesInternal(dispute: Dispute) {
    const messages = await this.messagesRepository.find({
      where: { disputeId: dispute.id },
      relations: { sender: true, senderPartner: true },
      order: { createdAt: 'ASC' },
    });

    return {
      data: {
        disputeId: dispute.id,
        canSend: !this.isTerminal(dispute.status),
        uploadsEnabled: this.cloudinaryService.isConfigured(),
        messages: messages.map((message) => this.toMessageResponse(message)),
      },
    };
  }

  private async createMessage(input: {
    dispute: Dispute;
    senderKind: DisputeMessageSenderKind;
    senderUserId: string | null;
    senderPartnerId: string | null;
    dto: CreateDisputeMessageDto;
    notifyAs:
      | { kind: 'user'; user: User }
      | { kind: 'partner'; partnerName: string };
  }) {
    const { dispute, dto } = input;

    if (this.isTerminal(dispute.status)) {
      throw new BadRequestException(
        'This dispute is closed. Messaging is no longer available.',
      );
    }

    const body = dto.body?.trim() ?? '';
    const attachment = dto.attachment
      ? this.normalizeAttachment(dto.attachment)
      : null;

    if (!body && !attachment) {
      throw new BadRequestException(
        'Provide a message body and/or an evidence attachment',
      );
    }

    if (attachment && !this.cloudinaryService.isConfigured()) {
      throw new BadRequestException(
        'Evidence uploads are not configured on this environment',
      );
    }

    if (
      attachment &&
      !this.cloudinaryService.isTrustedDeliveryUrl(attachment.url)
    ) {
      throw new BadRequestException(
        'attachment.url must be a Cloudinary delivery URL from the configured cloud',
      );
    }

    if (
      attachment?.publicId &&
      !attachment.publicId.startsWith(`amana/disputes/${dispute.id}`)
    ) {
      throw new BadRequestException(
        `attachment.publicId must be under amana/disputes/${dispute.id}`,
      );
    }

    const message = await this.messagesRepository.save({
      disputeId: dispute.id,
      senderUserId: input.senderUserId,
      senderPartnerId: input.senderPartnerId,
      senderKind: input.senderKind,
      body,
      attachmentUrl: attachment?.url ?? null,
      attachmentPublicId: attachment?.publicId ?? null,
      attachmentResourceType: attachment?.resourceType ?? null,
      attachmentMimeType: attachment?.mimeType ?? null,
      attachmentFileName: attachment?.fileName ?? null,
      attachmentBytes: attachment?.bytes ?? null,
    });

    const saved = await this.messagesRepository.findOne({
      where: { id: message.id },
      relations: { sender: true, senderPartner: true },
    });

    if (dispute.invoice) {
      const preview =
        body ||
        attachment?.fileName ||
        attachment?.publicId ||
        'Attached evidence';

      if (input.notifyAs.kind === 'user') {
        await this.notificationsService.notifyDisputeMessage({
          disputeId: dispute.id,
          invoice: dispute.invoice,
          sender: input.notifyAs.user,
          preview,
        });
      } else {
        await this.notificationsService.notifyDisputeMessage({
          disputeId: dispute.id,
          invoice: dispute.invoice,
          preview,
          fromPartnerName: input.notifyAs.partnerName,
        });
      }
    }

    return {
      message: 'Message sent',
      data: this.toMessageResponse(saved ?? message),
    };
  }

  private normalizeAttachment(attachment: NonNullable<CreateDisputeMessageDto['attachment']>) {
    return {
      url: attachment.url.trim(),
      publicId: attachment.publicId.trim(),
      resourceType: attachment.resourceType?.trim() || null,
      mimeType: attachment.mimeType?.trim() || null,
      fileName: attachment.fileName?.trim() || null,
      bytes: attachment.bytes ?? null,
    };
  }

  private async findPartnerDisputeOrThrow(partner: Partner, disputeId: string) {
    const dispute = await this.findDisputeOrThrow(disputeId);
    const invoice = dispute.invoice;

    if (!invoice || invoice.partnerId !== partner.id) {
      throw new ForbiddenException(
        'Dispute does not belong to this partner',
      );
    }

    if (invoice.sellerId !== partner.sellerId) {
      throw new ForbiddenException('Dispute seller mismatch');
    }

    return dispute;
  }

  private assertBuyerOrAdminChatAccess(user: User, dispute: Dispute) {
    if (user.role === 'admin') {
      return;
    }

    const isBuyer =
      dispute.raisedByUserId === user.id ||
      dispute.invoice?.buyerEmail?.toLowerCase() === user.email.toLowerCase();

    if (!isBuyer) {
      throw new ForbiddenException(
        'Only the buyer, partner API, and Amana ops can use dispute chat',
      );
    }
  }

  private toMessageResponse(message: DisputeMessage) {
    const sender = message.sender;
    const partner = message.senderPartner;
    const role: DisputeMessageSenderKind =
      message.senderPartnerId || message.senderKind === 'partner'
        ? 'partner'
        : sender?.role === 'admin' || message.senderKind === 'admin'
          ? 'admin'
          : 'buyer';

    if (role === 'partner' || partner) {
      return {
        id: message.id,
        disputeId: message.disputeId,
        body: message.body,
        createdAt: message.createdAt,
        attachment: this.toAttachmentResponse(message),
        sender: {
          id: partner?.id ?? message.senderPartnerId ?? 'partner',
          name: partner?.name ?? 'Partner',
          email: '',
          role: 'partner' as const,
        },
      };
    }

    return {
      id: message.id,
      disputeId: message.disputeId,
      body: message.body,
      createdAt: message.createdAt,
      attachment: this.toAttachmentResponse(message),
      sender: sender
        ? {
            id: sender.id,
            name: `${sender.firstname} ${sender.lastname}`.trim(),
            email: sender.email,
            role: (sender.role === 'admin' ? 'admin' : 'buyer') as
              | 'admin'
              | 'buyer',
          }
        : {
            id: message.senderUserId ?? 'unknown',
            name: 'User',
            email: '',
            role: 'buyer' as const,
          },
    };
  }

  private toAttachmentResponse(message: DisputeMessage) {
    if (!message.attachmentUrl) return null;
    return {
      url: message.attachmentUrl,
      publicId: message.attachmentPublicId,
      resourceType: message.attachmentResourceType,
      mimeType: message.attachmentMimeType,
      fileName: message.attachmentFileName,
      bytes: message.attachmentBytes,
    };
  }

  private assertDisputeAccess(user: User, dispute: Dispute) {
    const isBuyer = dispute.raisedByUserId === user.id;
    const isSeller =
      dispute.invoice?.sellerId === user.id ||
      dispute.invoice?.seller?.id === user.id;
    const isInvoiceBuyer =
      dispute.invoice?.buyerEmail?.toLowerCase() === user.email.toLowerCase();

    if (!isBuyer && !isSeller && !isInvoiceBuyer && user.role !== 'admin') {
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

  private toRaisedLocationResponse(dispute: Dispute) {
    if (
      dispute.raisedLatitude == null ||
      dispute.raisedLongitude == null ||
      !Number.isFinite(dispute.raisedLatitude) ||
      !Number.isFinite(dispute.raisedLongitude)
    ) {
      return null;
    }

    return {
      latitude: dispute.raisedLatitude,
      longitude: dispute.raisedLongitude,
      accuracy: dispute.raisedLocationAccuracy,
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
      raisedLocation: this.toRaisedLocationResponse(dispute),
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
    const invoice = dispute.invoice;

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
      buyerVerified: false,
      invoice: base.invoice
        ? {
            ...base.invoice,
            refundStatus: invoice?.refundStatus ?? null,
            refundReference: invoice?.refundReference ?? null,
            refundAt: invoice?.refundAt
              ? invoice.refundAt.toISOString()
              : null,
            refundError: invoice?.refundError ?? null,
          }
        : null,
    };
  }

  private async toAdminResponseAsync(dispute: Dispute) {
    const response = this.toAdminResponse(dispute);
    const buyerEmail = dispute.invoice?.buyerEmail;
    if (!buyerEmail) {
      return response;
    }

    const buyer = await this.usersService.findByEmail(buyerEmail);
    if (!buyer) {
      return response;
    }

    const buyerVerified = await this.usersService.isVerified(buyer.id);
    return {
      ...response,
      buyerVerified,
    };
  }
}
