import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute } from '../disputes/dispute.entity';
import { Invoice, InvoiceStatus } from '../invoices/invoice.entity';

type WeeklyBucket = {
  weekStart: string;
  amount: number;
};

type ActivityItem = {
  id: string;
  invoiceNumber: string;
  label: string;
  amount: number;
  currency: string;
  status: string;
  occurredAt: string;
  positive: boolean;
};

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    @InjectRepository(Dispute)
    private readonly disputesRepository: Repository<Dispute>,
  ) {}

  async getSellerDashboard(sellerId: string) {
    const invoices = await this.invoicesRepository.find({
      where: { sellerId },
      order: { updatedAt: 'DESC' },
    });

    const active = invoices.filter((invoice) => invoice.status !== 'cancelled');

    let fundsReleased = 0;
    let fundsInEscrow = 0;
    let awaitingPayment = 0;
    let releasedCount = 0;
    let escrowCount = 0;
    let awaitingPaymentCount = 0;

    const now = new Date();
    const thisMonthStart = this.startOfMonth(now);
    const lastMonthStart = this.startOfMonth(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    );
    const nextMonthStart = this.startOfMonth(
      new Date(now.getFullYear(), now.getMonth() + 1, 1),
    );

    let thisMonthReleased = 0;
    let lastMonthReleased = 0;
    let thisMonthReleasedCount = 0;
    let thisMonthFunded = 0;
    let lastMonthFunded = 0;
    let thisMonthFundedCount = 0;

    for (const invoice of active) {
      const amount = this.toAmount(invoice.amount);

      // Buyer paid into escrow (platform funded) — used for volume charts / funding stats.
      if (this.isReceived(invoice.status)) {
        const fundedAt = this.paymentReceivedAt(invoice);
        if (fundedAt) {
          if (fundedAt >= thisMonthStart && fundedAt < nextMonthStart) {
            thisMonthFunded += amount;
            thisMonthFundedCount += 1;
          } else if (fundedAt >= lastMonthStart && fundedAt < thisMonthStart) {
            lastMonthFunded += amount;
          }
        }
      }

      if (this.isReleased(invoice.status)) {
        fundsReleased += amount;
        releasedCount += 1;

        // Seller was paid (escrow released to seller account).
        const releasedAt = this.paymentReleasedAt(invoice);
        if (releasedAt) {
          if (releasedAt >= thisMonthStart && releasedAt < nextMonthStart) {
            thisMonthReleased += amount;
            thisMonthReleasedCount += 1;
          } else if (
            releasedAt >= lastMonthStart &&
            releasedAt < thisMonthStart
          ) {
            lastMonthReleased += amount;
          }
        }
      } else if (this.isHeldInEscrow(invoice.status)) {
        fundsInEscrow += amount;
        escrowCount += 1;
      } else if (
        invoice.status === 'pending' ||
        invoice.status === 'payment_initiated'
      ) {
        awaitingPayment += amount;
        awaitingPaymentCount += 1;
      }
    }

    // "Received" for sellers = money actually paid out to them.
    const thisMonthReceived = this.roundMoney(thisMonthReleased);
    const lastMonthReceived = this.roundMoney(lastMonthReleased);
    const thisMonthReceivedCount = thisMonthReleasedCount;

    fundsReleased = this.roundMoney(fundsReleased);
    fundsInEscrow = this.roundMoney(fundsInEscrow);
    awaitingPayment = this.roundMoney(awaitingPayment);
    thisMonthReleased = thisMonthReceived;
    lastMonthReleased = lastMonthReceived;
    thisMonthFunded = this.roundMoney(thisMonthFunded);
    lastMonthFunded = this.roundMoney(lastMonthFunded);

    const totalReceived = fundsReleased;

    const monthChangePercent =
      lastMonthReleased > 0
        ? ((thisMonthReleased - lastMonthReleased) / lastMonthReleased) * 100
        : thisMonthReleased > 0
          ? 100
          : null;

    const monthReceivedChangePercent = monthChangePercent;

    const completedPayments = releasedCount + escrowCount;
    const successRatePercent =
      completedPayments > 0
        ? Math.round((releasedCount / completedPayments) * 1000) / 10
        : null;

    const weeklyVolume = this.buildWeeklyVolume(active, 12);
    const weeklySummary = this.summarizeWeeklyVolume(weeklyVolume);

    return {
      data: {
        metrics: {
          fundsReleased,
          fundsInEscrow,
          awaitingPayment,
          totalReceived,
          releasedCount,
          escrowCount,
          awaitingPaymentCount,
          invoiceCount: active.length,
        },
        period: {
          thisMonthReceived,
          thisMonthReceivedCount,
          lastMonthReceived,
          monthReceivedChangePercent,
          thisMonthReleased,
          lastMonthReleased,
          monthChangePercent,
          thisMonthFunded,
          thisMonthFundedCount,
          lastMonthFunded,
          successRatePercent,
          completedPayments,
        },
        weeklyVolume,
        weeklySummary,
        recentActivity: this.buildRecentActivity(active),
      },
    };
  }

  async getBuyerDashboard(buyerEmail: string) {
    const email = buyerEmail.trim().toLowerCase();
    const invoices = await this.invoicesRepository
      .createQueryBuilder('invoice')
      .where('LOWER(invoice.buyer_email) = :email', { email })
      .orderBy('invoice.updated_at', 'DESC')
      .getMany();

    let inEscrow = 0;
    let inEscrowCount = 0;
    let awaitingPayment = 0;
    let awaitingPaymentCount = 0;
    let openDisputes = 0;

    for (const invoice of invoices) {
      const amount = this.toAmount(invoice.amount);
      if (invoice.status === 'paid_in_escrow') {
        inEscrow += amount;
        inEscrowCount += 1;
      } else if (invoice.status === 'disputed') {
        inEscrow += amount;
        inEscrowCount += 1;
        openDisputes += 1;
      } else if (
        invoice.status === 'pending' ||
        invoice.status === 'payment_initiated'
      ) {
        awaitingPayment += amount;
        awaitingPaymentCount += 1;
      }
    }

    const disputeRefunds = await this.getBuyerDisputeRefunds(email);

    return {
      data: {
        metrics: {
          inEscrow: this.roundMoney(inEscrow),
          inEscrowCount,
          awaitingPayment: this.roundMoney(awaitingPayment),
          awaitingPaymentCount,
          openDisputes,
          invoiceCount: invoices.length,
        },
        disputeRefunds,
      },
    };
  }

  private async getBuyerDisputeRefunds(buyerEmail: string) {
    const disputes = await this.disputesRepository
      .createQueryBuilder('dispute')
      .leftJoinAndSelect('dispute.invoice', 'invoice')
      .where('dispute.status = :status', { status: 'resolved_buyer' })
      .andWhere('LOWER(invoice.buyer_email) = :email', { email: buyerEmail })
      .orderBy('dispute.resolved_at', 'DESC')
      .addOrderBy('dispute.created_at', 'DESC')
      .getMany();

    let totalAmount = 0;
    let completedAmount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let processingCount = 0;
    let pendingCount = 0;

    const items = disputes.map((dispute) => {
      const invoice = dispute.invoice;
      const amount = this.toAmount(invoice?.amount ?? 0);
      const refundStatus = invoice?.refundStatus ?? null;

      totalAmount += amount;

      if (refundStatus === 'completed' || refundStatus === 'not_required') {
        completedAmount += amount;
        completedCount += 1;
      } else if (refundStatus === 'failed') {
        failedCount += 1;
      } else if (refundStatus === 'processing') {
        processingCount += 1;
      } else {
        pendingCount += 1;
      }

      return {
        disputeId: dispute.id,
        invoiceId: invoice?.id ?? dispute.invoiceId,
        invoiceNumber: invoice?.invoiceNumber ?? '—',
        amount: this.roundMoney(amount),
        currency: invoice?.currency ?? 'NGN',
        refundStatus,
        refundReference: invoice?.refundReference ?? null,
        refundAt: invoice?.refundAt ? invoice.refundAt.toISOString() : null,
        refundError: invoice?.refundError ?? null,
        resolvedAt: dispute.resolvedAt
          ? dispute.resolvedAt.toISOString()
          : dispute.createdAt.toISOString(),
      };
    });

    return {
      totalCount: items.length,
      totalAmount: this.roundMoney(totalAmount),
      completedCount,
      completedAmount: this.roundMoney(completedAmount),
      failedCount,
      processingCount,
      pendingCount,
      items,
    };
  }

  private isReleased(status: InvoiceStatus) {
    return status === 'released' || status === 'paid';
  }

  private isHeldInEscrow(status: InvoiceStatus) {
    return status === 'paid_in_escrow' || status === 'disputed';
  }

  private isReceived(status: InvoiceStatus) {
    return this.isHeldInEscrow(status) || this.isReleased(status);
  }

  /** When buyer funds first hit escrow — never use paidAt after release (it is overwritten). */
  private paymentReceivedAt(invoice: Invoice): Date | null {
    return this.asDate(
      invoice.escrowedAt ??
        (this.isReleased(invoice.status) ? invoice.releasedAt : invoice.paidAt),
    );
  }

  private paymentReleasedAt(invoice: Invoice): Date | null {
    if (!this.isReleased(invoice.status)) {
      return null;
    }

    return this.asDate(invoice.releasedAt ?? invoice.paidAt);
  }

  private toAmount(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    if (
      value &&
      typeof value === 'object' &&
      'toString' in value &&
      typeof value.toString === 'function'
    ) {
      const parsed = Number(value.toString());
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private startOfMonth(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), 1, 0, 0, 0, 0);
  }

  private asDate(value: Date | string | null | undefined): Date | null {
    if (value == null) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private buildWeeklyVolume(invoices: Invoice[], weeks: number): WeeklyBucket[] {
    const buckets: WeeklyBucket[] = [];
    const now = new Date();
    // Align to local week ending today, non-overlapping 7-day windows.
    const currentWeekEnd = new Date(now);
    currentWeekEnd.setHours(23, 59, 59, 999);

    for (let index = weeks - 1; index >= 0; index -= 1) {
      const weekEnd = new Date(currentWeekEnd);
      weekEnd.setDate(currentWeekEnd.getDate() - index * 7);

      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);
      weekStart.setHours(0, 0, 0, 0);

      let amount = 0;
      for (const invoice of invoices) {
        // Chart = what the seller was paid (released), not escrow funding.
        if (!this.isReleased(invoice.status)) {
          continue;
        }

        const releasedAt = this.paymentReleasedAt(invoice);
        if (!releasedAt) {
          continue;
        }

        if (releasedAt >= weekStart && releasedAt <= weekEnd) {
          amount += this.toAmount(invoice.amount);
        }
      }

      buckets.push({
        weekStart: weekStart.toISOString(),
        amount: this.roundMoney(amount),
      });
    }

    return buckets;
  }

  private summarizeWeeklyVolume(weeklyVolume: WeeklyBucket[]) {
    const amounts = weeklyVolume.map((bucket) => bucket.amount);
    const activeWeeks = amounts.filter((amount) => amount > 0).length;
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    const peakWeek = amounts.length > 0 ? Math.max(...amounts) : 0;
    const averageTransfer = activeWeeks > 0 ? total / activeWeeks : 0;

    return {
      averageTransfer: this.roundMoney(averageTransfer),
      peakWeek: this.roundMoney(peakWeek),
      activeWeeks,
    };
  }

  private buildRecentActivity(invoices: Invoice[]): ActivityItem[] {
    const items: ActivityItem[] = [];

    for (const invoice of invoices) {
      const amount = this.toAmount(invoice.amount);
      const occurredAt = this.activityTimestamp(invoice);
      if (!occurredAt) {
        continue;
      }

      const activity = this.activityForInvoice(invoice, amount, occurredAt);
      if (activity) {
        items.push(activity);
      }
    }

    return items
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() -
          new Date(left.occurredAt).getTime(),
      )
      .slice(0, 8);
  }

  private activityTimestamp(invoice: Invoice): Date | null {
    return this.asDate(
      invoice.releasedAt ??
        invoice.escrowedAt ??
        invoice.paidAt ??
        invoice.paymentInitiatedAt ??
        invoice.createdAt,
    );
  }

  private activityForInvoice(
    invoice: Invoice,
    amount: number,
    occurredAt: Date,
  ): ActivityItem | null {
    const buyer = invoice.buyerName ?? invoice.buyerEmail;

    if (this.isReleased(invoice.status)) {
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        label: `Funds released from ${buyer}`,
        amount,
        currency: invoice.currency,
        status: 'Released',
        occurredAt: occurredAt.toISOString(),
        positive: true,
      };
    }

    if (invoice.status === 'paid_in_escrow') {
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        label: `Payment in escrow from ${buyer}`,
        amount,
        currency: invoice.currency,
        status: 'In escrow',
        occurredAt: occurredAt.toISOString(),
        positive: true,
      };
    }

    if (invoice.status === 'payment_initiated') {
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        label: `Payment initiated by ${buyer}`,
        amount,
        currency: invoice.currency,
        status: 'Initiated',
        occurredAt: occurredAt.toISOString(),
        positive: false,
      };
    }

    if (invoice.status === 'pending') {
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        label: `Invoice sent to ${buyer}`,
        amount,
        currency: invoice.currency,
        status: 'Awaiting payment',
        occurredAt: occurredAt.toISOString(),
        positive: false,
      };
    }

    if (invoice.status === 'disputed') {
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        label: `Dispute open with ${buyer}`,
        amount,
        currency: invoice.currency,
        status: 'Disputed',
        occurredAt: occurredAt.toISOString(),
        positive: false,
      };
    }

    return null;
  }
}
