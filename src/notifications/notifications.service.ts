import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { Notification } from './notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    private readonly usersService: UsersService,
  ) {}

  async notifyInvoiceReceived(invoice: Invoice, seller: User) {
    const buyer = await this.usersService.findByEmail(invoice.buyerEmail);

    if (!buyer) {
      return null;
    }

    const sellerName = `${seller.firstname} ${seller.lastname}`.trim();
    const amount = Number(invoice.amount).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const link = `/main/invoices?tab=received&view=${invoice.id}`;

    return this.notificationsRepository.save({
      userId: buyer.id,
      type: 'invoice_received',
      title: 'New invoice received',
      message: `${sellerName} sent you an invoice for ₦${amount} (${invoice.invoiceNumber}).`,
      link,
      invoiceId: invoice.id,
    });
  }

  async notifyInvoiceEscrowed(invoice: Invoice, seller: User) {
    const amount = Number(invoice.amount).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const buyerLabel = invoice.buyerName ?? invoice.buyerEmail;
    const sellerName = `${seller.firstname} ${seller.lastname}`.trim();
    const sellerLink = `/main/invoices?tab=sent&view=${invoice.id}`;
    const buyerLink = `/main/invoices?tab=received&view=${invoice.id}`;

    await this.notificationsRepository.save({
      userId: seller.id,
      type: 'invoice_escrowed',
      title: 'Payment held in escrow',
      message: `${buyerLabel} paid ₦${amount} for ${invoice.invoiceNumber}. Funds are held until the buyer confirms with delivery OTP ${invoice.deliveryOtpCode ?? '———'}. Share that code with your courier at handoff.`,
      link: sellerLink,
      invoiceId: invoice.id,
    });

    const buyer = await this.usersService.findByEmail(invoice.buyerEmail);
    if (!buyer) {
      return null;
    }

    return this.notificationsRepository.save({
      userId: buyer.id,
      type: 'invoice_escrowed',
      title: 'Payment received — held in escrow',
      message: `Your ₦${amount} payment for ${invoice.invoiceNumber} is held securely. When ${sellerName} delivers, enter their delivery OTP and confirm receipt to release funds.`,
      link: buyerLink,
      invoiceId: invoice.id,
    });
  }

  async notifyInvoiceReleased(invoice: Invoice, seller: User) {
    const amount = Number(invoice.amount).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const buyerLabel = invoice.buyerName ?? invoice.buyerEmail;

    return this.notificationsRepository.save({
      userId: seller.id,
      type: 'invoice_released',
      title: 'Funds released',
      message: `${buyerLabel} confirmed receipt. ₦${amount} for ${invoice.invoiceNumber} has been released to you.`,
      link: `/main/invoices?tab=sent&view=${invoice.id}`,
      invoiceId: invoice.id,
    });
  }

  async notifyDisputeOpened(
    dispute: {
      id: string;
      reason: string;
      raisedLatitude?: number | null;
      raisedLongitude?: number | null;
    },
    invoice: Invoice,
  ) {
    const seller =
      invoice.seller ??
      (await this.usersService.findById(invoice.sellerId));

    if (!seller) {
      return;
    }

    const buyerLabel = invoice.buyerName ?? invoice.buyerEmail;
    const reasonLabel = dispute.reason.replace(/_/g, ' ');
    const adminLink = `/main/admin/disputes?id=${dispute.id}`;
    const sellerInvoiceLink = `/main/invoices?tab=sent&view=${invoice.id}`;
    const buyerInvoiceLink = `/main/invoices?tab=received&view=${invoice.id}`;

    await this.notificationsRepository.save({
      userId: seller.id,
      type: 'dispute_opened',
      title: 'Dispute opened',
      message: `${buyerLabel} opened a dispute on ${invoice.invoiceNumber} (${reasonLabel}). Please respond within 24 hours. Funds remain locked pending review.`,
      link: sellerInvoiceLink,
      invoiceId: invoice.id,
    });

    const buyer = await this.usersService.findByEmail(invoice.buyerEmail);
    if (buyer) {
      await this.notificationsRepository.save({
        userId: buyer.id,
        type: 'dispute_opened',
        title: 'Dispute submitted',
        message: `Your dispute for ${invoice.invoiceNumber} was submitted. The seller has 24 hours to respond. Amana will review within 72 hours and decide within 5 business days.`,
        link: buyerInvoiceLink,
        invoiceId: invoice.id,
      });

      const verified = await this.usersService.isVerified(buyer.id);
      if (!verified) {
        await this.notificationsRepository.save({
          userId: buyer.id,
          type: 'verify_for_refund',
          title: 'Verify your account',
          message: `Verify your account in Settings so we can refund you if your dispute on ${invoice.invoiceNumber} is resolved in your favour.`,
          link: '/main/settings',
          invoiceId: invoice.id,
        });
      }
    }

    const admins = await this.usersService.listAdmins();
    const locationNote = this.formatDisputeLocationForNotification(dispute);

    await Promise.all(
      admins.map((admin) =>
        this.notificationsRepository.save({
          userId: admin.id,
          type: 'dispute_opened',
          title: 'New dispute',
          message: `${buyerLabel} disputed ${invoice.invoiceNumber} (${reasonLabel}).${locationNote}`,
          link: adminLink,
          invoiceId: invoice.id,
        }),
      ),
    );
  }

  private formatDisputeLocationForNotification(dispute: {
    raisedLatitude?: number | null;
    raisedLongitude?: number | null;
  }) {
    if (
      dispute.raisedLatitude == null ||
      dispute.raisedLongitude == null ||
      !Number.isFinite(dispute.raisedLatitude) ||
      !Number.isFinite(dispute.raisedLongitude)
    ) {
      return ' Location not shared.';
    }

    return ` Raised near ${dispute.raisedLatitude.toFixed(5)}, ${dispute.raisedLongitude.toFixed(5)}.`;
  }

  async notifyDisputeResolved(
    invoice: Invoice,
    seller: User,
    outcome: 'resolved_buyer' | 'resolved_seller' | 'closed',
  ) {
    const buyer = await this.usersService.findByEmail(invoice.buyerEmail);
    const sellerLink = `/main/invoices?view=${invoice.id}`;
    const messages = {
      resolved_buyer:
        'The dispute was resolved in your favour. If your account is verified, the refund is being sent to your Amana account.',
      resolved_seller:
        'The dispute was resolved in the seller\'s favour. Funds have been released.',
      closed:
        'The dispute was closed. The invoice has returned to escrow status.',
    };

    if (buyer) {
      await this.notificationsRepository.save({
        userId: buyer.id,
        type: 'dispute_resolved',
        title: 'Dispute resolved',
        message: `${messages[outcome]} (${invoice.invoiceNumber})`,
        link: sellerLink,
        invoiceId: invoice.id,
      });
    }

    await this.notificationsRepository.save({
      userId: seller.id,
      type: 'dispute_resolved',
      title: 'Dispute resolved',
      message: `${messages[outcome]} (${invoice.invoiceNumber})`,
      link: sellerLink,
      invoiceId: invoice.id,
    });
  }

  async notifyInvoicePaid(invoice: Invoice, seller: User) {
    const amount = Number(invoice.amount).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const buyerLabel = invoice.buyerName ?? invoice.buyerEmail;

    return this.notificationsRepository.save({
      userId: seller.id,
      type: 'invoice_paid',
      title: 'Invoice paid',
      message: `${buyerLabel} paid ₦${amount} for ${invoice.invoiceNumber}.`,
      link: `/main/invoices?view=${invoice.id}`,
      invoiceId: invoice.id,
    });
  }

  async notifyPartnerAccessRequested(
    request: { id: string; businessName: string },
    seller: User,
  ) {
    const sellerName = `${seller.firstname} ${seller.lastname}`.trim();
    const admins = await this.usersService.listAdmins();
    const link = `/main/admin/partners?request=${request.id}`;

    await Promise.all(
      admins.map((admin) =>
        this.notificationsRepository.save({
          userId: admin.id,
          type: 'partner_access_requested',
          title: 'Partner API access requested',
          message: `${sellerName} (${seller.email}) requested marketplace API access for “${request.businessName}”.`,
          link,
          invoiceId: null,
        }),
      ),
    );
  }

  async notifyPartnerAccessReviewed(
    seller: User,
    outcome: 'approved' | 'rejected',
    reviewNotes?: string | null,
  ) {
    const approved = outcome === 'approved';
    const notes = reviewNotes?.trim()
      ? ` Note: ${reviewNotes.trim()}`
      : '';

    return this.notificationsRepository.save({
      userId: seller.id,
      type: approved ? 'partner_access_approved' : 'partner_access_rejected',
      title: approved
        ? 'Partner API access approved'
        : 'Partner API access rejected',
      message: approved
        ? `Your marketplace API access was approved. Open Developers to generate your API key.${notes}`
        : `Your marketplace API access request was rejected.${notes}`,
      link: '/main/developers',
      invoiceId: null,
    });
  }

  async listForUser(userId: string, limit = 20) {
    const notifications = await this.notificationsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return {
      data: notifications.map((notification) => this.toResponse(notification)),
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.notificationsRepository
      .createQueryBuilder('notification')
      .where('notification.user_id = :userId', { userId })
      .andWhere('notification.read_at IS NULL')
      .getCount();

    return { count };
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.notificationsRepository.findOne({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationsRepository.save(notification);
    }

    return { data: this.toResponse(notification) };
  }

  async markAllAsRead(userId: string) {
    await this.notificationsRepository
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: () => 'CURRENT_TIMESTAMP' })
      .where('user_id = :userId', { userId })
      .andWhere('read_at IS NULL')
      .execute();

    return { message: 'All notifications marked as read' };
  }

  private toResponse(notification: Notification) {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      link: notification.link,
      invoiceId: notification.invoiceId,
      read: Boolean(notification.readAt),
      createdAt: notification.createdAt,
    };
  }
}
