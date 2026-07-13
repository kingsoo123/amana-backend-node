import {
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute } from '../disputes/dispute.entity';
import { DisputesService } from '../disputes/disputes.service';
import { EscrowSettlementService } from '../escrow/escrow-settlement.service';
import { Invoice } from '../invoices/invoice.entity';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AdminResolveDisputeDto } from '../disputes/dto/admin-resolve-dispute.dto';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    @InjectRepository(Dispute)
    private readonly disputesRepository: Repository<Dispute>,
    private readonly usersService: UsersService,
    private readonly disputesService: DisputesService,
    private readonly escrowSettlement: EscrowSettlementService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    if (adminEmail) {
      await this.usersService.promoteAdminByEmail(adminEmail);
    }
  }

  async getOverview() {
    const [userCount, invoiceCount, openDisputes, disputedInvoices] =
      await Promise.all([
        this.usersRepository.count(),
        this.invoicesRepository.count(),
        this.disputesRepository.count({
          where: [{ status: 'open' }, { status: 'under_review' }],
        }),
        this.invoicesRepository.count({ where: { status: 'disputed' } }),
      ]);

    const invoices = await this.invoicesRepository.find();
    let totalVolume = 0;
    let escrowVolume = 0;
    let releasedVolume = 0;

    for (const invoice of invoices) {
      if (invoice.status === 'cancelled') {
        continue;
      }

      const amount = Number(invoice.amount);
      totalVolume += amount;

      if (invoice.status === 'paid_in_escrow' || invoice.status === 'disputed') {
        escrowVolume += amount;
      }

      if (invoice.status === 'released' || invoice.status === 'paid') {
        releasedVolume += amount;
      }
    }

    const disputeRefunds = await this.getDisputeRefundSummary();

    const trueHoldEnabled = this.escrowSettlement.isTrueHoldEnabled();
    const collection = trueHoldEnabled
      ? await this.escrowSettlement.getCollectionAccount()
      : null;

    return {
      data: {
        userCount,
        invoiceCount,
        openDisputes,
        disputedInvoices,
        totalVolume,
        escrowVolume,
        releasedVolume,
        disputeRefunds,
        escrowHold: {
          enabled: trueHoldEnabled,
          configured: Boolean(collection),
          account: collection
            ? {
                accountNumber: collection.accountNumber,
                bankName: collection.bankName,
                accountStatus: collection.accountStatus,
                holderName: collection.holderName,
                bankCode: collection.bankCode,
                adminEmail: collection.adminEmail,
              }
            : null,
        },
      },
    };
  }

  private async getDisputeRefundSummary() {
    const disputes = await this.disputesRepository.find({
      where: { status: 'resolved_buyer' },
      relations: { invoice: true },
      order: { resolvedAt: 'DESC', createdAt: 'DESC' },
    });

    let totalAmount = 0;
    let completedAmount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let processingCount = 0;
    let pendingCount = 0;

    const items = disputes.map((dispute) => {
      const invoice = dispute.invoice;
      const amount = Number(invoice?.amount ?? 0);
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
        buyerEmail: invoice?.buyerEmail ?? '—',
        buyerName: invoice?.buyerName ?? null,
        amount,
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
      totalAmount,
      completedCount,
      completedAmount,
      failedCount,
      processingCount,
      pendingCount,
      items,
    };
  }

  async listUsers() {
    const users = await this.usersService.listAll();

    const data = await Promise.all(
      users.map(async (user) => ({
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role,
        verified: await this.usersService.isVerified(user.id),
        createdAt: user.createdAt,
      })),
    );

    return { data };
  }

  async updateUserRole(userId: string, role: User['role']) {
    const user = await this.usersService.setRole(userId, role);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      message: 'User role updated',
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  async listInvoices() {
    const invoices = await this.invoicesRepository.find({
      relations: { seller: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });

    return {
      data: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        buyerEmail: invoice.buyerEmail,
        buyerName: invoice.buyerName,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        status: invoice.status,
        createdAt: invoice.createdAt,
        seller: invoice.seller
          ? {
              id: invoice.seller.id,
              name: `${invoice.seller.firstname} ${invoice.seller.lastname}`.trim(),
              email: invoice.seller.email,
            }
          : null,
      })),
    };
  }

  listDisputes(status?: string) {
    return this.disputesService.listAll(status);
  }

  resolveDispute(admin: User, disputeId: string, dto: AdminResolveDisputeDto) {
    return this.disputesService.adminResolve(admin, disputeId, dto);
  }

  retryDisputeRefund(admin: User, disputeId: string) {
    return this.disputesService.adminRetryRefund(admin, disputeId);
  }
}
