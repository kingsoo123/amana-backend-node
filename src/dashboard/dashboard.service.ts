import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    let thisMonthReleased = 0;
    let lastMonthReleased = 0;
    let thisMonthReceived = 0;
    let lastMonthReceived = 0;
    let thisMonthReceivedCount = 0;

    for (const invoice of active) {
      const amount = Number(invoice.amount);

      if (this.isReceived(invoice.status)) {
        const receivedAt = this.asDate(invoice.escrowedAt ?? invoice.paidAt);
        if (receivedAt) {
          if (receivedAt >= thisMonthStart) {
            thisMonthReceived += amount;
            thisMonthReceivedCount += 1;
          } else if (receivedAt >= lastMonthStart && receivedAt < thisMonthStart) {
            lastMonthReceived += amount;
          }
        }
      }

      if (this.isReleased(invoice.status)) {
        fundsReleased += amount;
        releasedCount += 1;

        const releasedAt = this.asDate(invoice.releasedAt ?? invoice.paidAt);
        if (releasedAt) {
          if (releasedAt >= thisMonthStart) {
            thisMonthReleased += amount;
          } else if (releasedAt >= lastMonthStart && releasedAt < thisMonthStart) {
            lastMonthReleased += amount;
          }
        }
      } else if (invoice.status === 'paid_in_escrow') {
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

    const totalReceived = fundsReleased + fundsInEscrow;
    const monthChangePercent =
      lastMonthReleased > 0
        ? ((thisMonthReleased - lastMonthReleased) / lastMonthReleased) * 100
        : thisMonthReleased > 0
          ? 100
          : null;

    const monthReceivedChangePercent =
      lastMonthReceived > 0
        ? ((thisMonthReceived - lastMonthReceived) / lastMonthReceived) * 100
        : thisMonthReceived > 0
          ? 100
          : null;

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
          successRatePercent,
          completedPayments,
        },
        weeklyVolume,
        weeklySummary,
        recentActivity: this.buildRecentActivity(active),
      },
    };
  }

  private isReleased(status: InvoiceStatus) {
    return status === 'released' || status === 'paid';
  }

  private isReceived(status: InvoiceStatus) {
    return (
      status === 'paid_in_escrow' ||
      status === 'disputed' ||
      status === 'released' ||
      status === 'paid'
    );
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

    for (let index = weeks - 1; index >= 0; index -= 1) {
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - index * 7);
      weekEnd.setHours(23, 59, 59, 999);

      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);
      weekStart.setHours(0, 0, 0, 0);

      let amount = 0;
      for (const invoice of invoices) {
        const receivedAt = this.asDate(
          invoice.escrowedAt ?? invoice.releasedAt ?? invoice.paidAt,
        );
        if (!receivedAt) {
          continue;
        }

        if (receivedAt >= weekStart && receivedAt <= weekEnd) {
          amount += Number(invoice.amount);
        }
      }

      buckets.push({
        weekStart: weekStart.toISOString(),
        amount,
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
      averageTransfer,
      peakWeek,
      activeWeeks,
    };
  }

  private buildRecentActivity(invoices: Invoice[]): ActivityItem[] {
    const items: ActivityItem[] = [];

    for (const invoice of invoices) {
      const amount = Number(invoice.amount);
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
        invoice.paidAt ??
        invoice.escrowedAt ??
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
