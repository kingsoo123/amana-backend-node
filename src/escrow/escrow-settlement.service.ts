import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { FlutterwaveTransfersService } from '../flutterwave/flutterwave-transfers.service';
import { Invoice } from '../invoices/invoice.entity';
import { UsersService } from '../users/users.service';

export type EscrowCollectionAccount = {
  accountNumber: string;
  bankName: string;
  accountStatus: string;
  holderName: string;
  bankCode: string | null;
  adminUserId: string;
  adminEmail: string;
  isPlatformEscrow: true;
};

@Injectable()
export class EscrowSettlementService {
  private readonly logger = new Logger(EscrowSettlementService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly accountsService: AccountsService,
    private readonly flutterwaveTransfers: FlutterwaveTransfersService,
    private readonly usersService: UsersService,
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
  ) {}

  isTrueHoldEnabled(): boolean {
    return this.configService.get<string>('ESCROW_TRUE_HOLD') === 'true';
  }

  /**
   * Platform escrow collection account = active DVA on the configured admin
   * (ADMIN_EMAIL), falling back to the first admin with an active DVA.
   */
  async getCollectionAccount(): Promise<EscrowCollectionAccount | null> {
    if (!this.isTrueHoldEnabled()) {
      return null;
    }

    const admin = await this.resolveEscrowAdmin();
    if (!admin) {
      this.logger.warn(
        'ESCROW_TRUE_HOLD is enabled but no admin user is available for the escrow DVA',
      );
      return null;
    }

    const dva = await this.accountsService.findActiveVirtualAccount(admin.id);
    if (!dva) {
      this.logger.warn(
        `ESCROW_TRUE_HOLD is enabled but admin ${admin.email} has no active virtual account`,
      );
      return null;
    }

    const holderName =
      `${admin.firstname} ${admin.lastname}`.trim() || 'Amana Escrow';

    return {
      accountNumber: dva.accountNumber,
      bankName: dva.bankName,
      accountStatus: dva.accountStatus,
      holderName,
      bankCode: dva.bankCode,
      adminUserId: admin.id,
      adminEmail: admin.email,
      isPlatformEscrow: true,
    };
  }

  async getPaymentAccountForInvoice(invoice: Invoice) {
    const platform = await this.getCollectionAccount();
    if (platform) {
      return platform;
    }

    const sellerDva = await this.accountsService.findActiveVirtualAccount(
      invoice.sellerId,
    );
    if (!sellerDva) {
      return null;
    }

    return {
      accountNumber: sellerDva.accountNumber,
      bankName: sellerDva.bankName,
      accountStatus: sellerDva.accountStatus,
      holderName: null as string | null,
      bankCode: sellerDva.bankCode,
      isPlatformEscrow: false as const,
    };
  }

  async payoutToSeller(invoice: Invoice): Promise<Invoice> {
    if (!this.isTrueHoldEnabled()) {
      invoice.payoutStatus = 'not_required';
      invoice.payoutAt = new Date();
      return this.invoicesRepository.save(invoice);
    }

    if (
      invoice.payoutStatus === 'completed' ||
      invoice.payoutStatus === 'processing'
    ) {
      return invoice;
    }

    const sellerDva = await this.accountsService.findActiveVirtualAccount(
      invoice.sellerId,
    );
    if (!sellerDva) {
      throw new BadRequestException(
        'Seller payout account is not available. Complete seller verification before releasing funds.',
      );
    }

    const bankCode =
      sellerDva.bankCode ||
      (await this.flutterwaveTransfers.resolveBankCode(sellerDva.bankName)) ||
      (this.flutterwaveTransfers.isMockEnabled() ? '999' : null);

    if (!bankCode) {
      throw new BadRequestException(
        `Unable to resolve bank code for seller bank “${sellerDva.bankName}”. Update the seller virtual account bank code.`,
      );
    }

    const reference = `OUT-${invoice.paymentReference}-${randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;

    invoice.payoutStatus = 'processing';
    invoice.payoutReference = reference;
    invoice.payoutError = null;
    await this.invoicesRepository.save(invoice);

    try {
      const transfer = await this.flutterwaveTransfers.createTransfer({
        accountBank: bankCode,
        accountNumber: sellerDva.accountNumber,
        amount: Number(invoice.amount),
        currency: invoice.currency || 'NGN',
        narration: `Amana escrow release ${invoice.invoiceNumber}`,
        reference,
      });

      invoice.payoutStatus =
        transfer.status === 'FAILED' || transfer.status === 'FAILURE'
          ? 'failed'
          : transfer.status === 'SUCCESSFUL' || transfer.mocked
            ? 'completed'
            : 'processing';
      invoice.payoutTransferId = transfer.id != null ? String(transfer.id) : null;
      invoice.payoutReference = transfer.reference;
      invoice.payoutAt = new Date();
      invoice.payoutError = null;
      return this.invoicesRepository.save(invoice);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Payout failed';
      invoice.payoutStatus = 'failed';
      invoice.payoutError = message;
      await this.invoicesRepository.save(invoice);
      throw error;
    }
  }

  async refundToBuyer(invoice: Invoice): Promise<Invoice> {
    if (!this.isTrueHoldEnabled()) {
      invoice.refundStatus = 'not_required';
      invoice.refundAt = new Date();
      invoice.refundError = null;
      return this.invoicesRepository.save(invoice);
    }

    if (
      invoice.refundStatus === 'completed' ||
      invoice.refundStatus === 'processing'
    ) {
      return invoice;
    }

    const buyer = await this.usersService.findByEmail(invoice.buyerEmail);
    if (!buyer) {
      throw new BadRequestException(
        'Buyer does not have an Amana account. Ask them to sign up and verify before refunding.',
      );
    }

    const buyerDva = await this.accountsService.findActiveVirtualAccount(
      buyer.id,
    );
    if (!buyerDva) {
      throw new BadRequestException(
        'Buyer is not verified. Ask them to complete verification in Settings so a refund can be sent to their account.',
      );
    }

    const bankCode =
      buyerDva.bankCode ||
      (await this.flutterwaveTransfers.resolveBankCode(buyerDva.bankName)) ||
      (this.flutterwaveTransfers.isMockEnabled() ? '999' : null);

    if (!bankCode) {
      throw new BadRequestException(
        `Unable to resolve bank code for buyer bank “${buyerDva.bankName}”. Update the buyer virtual account bank code.`,
      );
    }

    const reference = `REF-${invoice.paymentReference}-${randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;

    invoice.refundStatus = 'processing';
    invoice.refundReference = reference;
    invoice.refundError = null;
    await this.invoicesRepository.save(invoice);

    try {
      const transfer = await this.flutterwaveTransfers.createTransfer({
        accountBank: bankCode,
        accountNumber: buyerDva.accountNumber,
        amount: Number(invoice.amount),
        currency: invoice.currency || 'NGN',
        narration: `Amana dispute refund ${invoice.invoiceNumber}`,
        reference,
      });

      invoice.refundStatus =
        transfer.status === 'FAILED' || transfer.status === 'FAILURE'
          ? 'failed'
          : transfer.status === 'SUCCESSFUL' || transfer.mocked
            ? 'completed'
            : 'processing';
      invoice.refundReference = transfer.reference;
      invoice.refundAt = new Date();
      invoice.refundError =
        invoice.refundStatus === 'failed'
          ? 'Flutterwave reported the refund transfer as failed'
          : null;
      return this.invoicesRepository.save(invoice);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Refund failed';
      invoice.refundStatus = 'failed';
      invoice.refundError = message;
      await this.invoicesRepository.save(invoice);
      throw error;
    }
  }

  private async resolveEscrowAdmin() {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL')?.trim();
    if (adminEmail) {
      const configured = await this.usersService.findByEmail(adminEmail);
      if (configured?.role === 'admin') {
        return configured;
      }
      if (configured) {
        this.logger.warn(
          `ADMIN_EMAIL ${adminEmail} is not an admin role; falling back to any admin with a DVA`,
        );
      }
    }

    const admins = await this.usersService.listAdmins();
    for (const admin of admins) {
      const dva = await this.accountsService.findActiveVirtualAccount(admin.id);
      if (dva) {
        return admin;
      }
    }

    return admins[0] ?? null;
  }
}
