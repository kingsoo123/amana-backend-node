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
    const link = `/main/invoices?view=${invoice.id}`;

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
    const link = `/main/invoices?view=${invoice.id}`;

    await this.notificationsRepository.save({
      userId: seller.id,
      type: 'invoice_escrowed',
      title: 'Payment held in escrow',
      message: `${buyerLabel} paid ₦${amount} for ${invoice.invoiceNumber}. Funds are held until the buyer confirms receipt.`,
      link,
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
      message: `Your ₦${amount} payment for ${invoice.invoiceNumber} is held securely. Confirm receipt when ${sellerName} delivers your items.`,
      link,
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
      link: `/main/invoices?view=${invoice.id}`,
      invoiceId: invoice.id,
    });
  }

  async notifyDisputeOpened(
    dispute: { id: string; reason: string },
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
    const invoiceLink = `/main/invoices?view=${invoice.id}`;

    await this.notificationsRepository.save({
      userId: seller.id,
      type: 'dispute_opened',
      title: 'Dispute opened',
      message: `${buyerLabel} opened a dispute on ${invoice.invoiceNumber} (${reasonLabel}). Please respond within 24 hours. Funds remain locked pending review.`,
      link: invoiceLink,
      invoiceId: invoice.id,
    });

    const buyer = await this.usersService.findByEmail(invoice.buyerEmail);
    if (buyer) {
      await this.notificationsRepository.save({
        userId: buyer.id,
        type: 'dispute_opened',
        title: 'Dispute submitted',
        message: `Your dispute for ${invoice.invoiceNumber} was submitted. The seller has 24 hours to respond. Amana will review within 72 hours and decide within 5 business days.`,
        link: invoiceLink,
        invoiceId: invoice.id,
      });
    }

    const admins = await this.usersService.listAdmins();
    await Promise.all(
      admins.map((admin) =>
        this.notificationsRepository.save({
          userId: admin.id,
          type: 'dispute_opened',
          title: 'New dispute',
          message: `${buyerLabel} disputed ${invoice.invoiceNumber} (${reasonLabel}).`,
          link: adminLink,
          invoiceId: invoice.id,
        }),
      ),
    );
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
        'The dispute was resolved in your favour. A refund will be processed according to our policy.',
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
