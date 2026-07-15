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
import { randomBytes, randomInt } from 'crypto';
import { Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { DisputesService } from '../disputes/disputes.service';
import { EscrowSettlementService } from '../escrow/escrow-settlement.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../partners/webhooks.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { Invoice, InvoiceStatus } from './invoice.entity';

export type CreateInvoiceOptions = {
  partnerId?: string | null;
  externalReference?: string | null;
  metadata?: Record<string, unknown> | null;
  successUrl?: string | null;
  cancelUrl?: string | null;
};

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    private readonly accountsService: AccountsService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly escrowSettlement: EscrowSettlementService,
    @Inject(forwardRef(() => DisputesService))
    private readonly disputesService: DisputesService,
    @Optional()
    @Inject(forwardRef(() => WebhooksService))
    private readonly webhooksService?: WebhooksService,
  ) {}

  async createInvoice(
    seller: User,
    dto: CreateInvoiceDto,
    options?: CreateInvoiceOptions,
  ) {
    await this.assertVerifiedUser(seller.id);

    if (seller.role !== 'admin' && seller.role !== 'seller') {
      seller = await this.usersService.promoteToSeller(seller);
    }

    const dva = await this.accountsService.findActiveVirtualAccount(seller.id);
    if (!dva) {
      throw new BadRequestException(
        'You need an active virtual account to receive invoice payments',
      );
    }

    const buyerEmail = dto.buyerEmail.trim().toLowerCase();
    if (buyerEmail === seller.email.toLowerCase()) {
      throw new BadRequestException('You cannot send an invoice to yourself');
    }

    const invoiceNumber = this.generateInvoiceNumber();
    const paymentReference = this.generatePaymentReference();
    const shareToken = randomBytes(24).toString('hex');

    const invoice = await this.invoicesRepository.save({
      invoiceNumber,
      sellerId: seller.id,
      buyerEmail,
      buyerName: dto.buyerName?.trim() || null,
      amount: dto.amount.toFixed(2),
      currency: 'NGN',
      description: dto.description?.trim() || null,
      status: 'pending',
      paymentReference,
      shareToken,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      partnerId: options?.partnerId ?? null,
      externalReference: options?.externalReference?.trim() || null,
      metadata: options?.metadata ?? null,
      successUrl: options?.successUrl ?? null,
      cancelUrl: options?.cancelUrl ?? null,
    });

    const notification =
      await this.notificationsService.notifyInvoiceReceived(invoice, seller);

    const response = this.toInvoiceResponse(invoice, seller, dva);
    return {
      ...response,
      notificationSent: Boolean(notification),
    };
  }

  async searchBuyers(seller: User, query: string) {
    await this.assertVerifiedUser(seller.id);

    const buyers = await this.usersService.searchBuyers(query, seller.id);

    return {
      data: buyers.map((buyer) => ({
        id: buyer.id,
        firstname: buyer.firstname,
        lastname: buyer.lastname,
        email: buyer.email,
        phoneNumber: buyer.phoneNumber,
        displayName: `${buyer.firstname} ${buyer.lastname}`.trim(),
      })),
    };
  }

  async listSent(sellerId: string) {
    await this.assertVerifiedUser(sellerId);

    const invoices = await this.invoicesRepository.find({
      where: { sellerId },
      order: { createdAt: 'DESC' },
      relations: { seller: true },
    });

    return {
      data: invoices.map((invoice) => this.toInvoiceSummary(invoice)),
    };
  }

  async listReceived(buyerEmail: string, _userId: string) {
    const normalizedEmail = buyerEmail.trim().toLowerCase();
    const invoices = await this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.seller', 'seller')
      .where('LOWER(invoice.buyerEmail) = :email', { email: normalizedEmail })
      .orderBy('invoice.createdAt', 'DESC')
      .getMany();

    return {
      data: invoices.map((invoice) => this.toInvoiceSummary(invoice)),
    };
  }

  async getInvoiceForUser(user: User, invoiceId: string) {
    const invoice = await this.findInvoiceOrThrow(invoiceId);
    this.assertInvoiceAccess(user, invoice);

    const isSeller = invoice.sellerId === user.id;
    if (isSeller) {
      await this.assertVerifiedUser(user.id);
    }

    if (await this.ensureDeliveryOtp(invoice)) {
      await this.invoicesRepository.save(invoice);
    }

    const paymentAccount =
      await this.escrowSettlement.getPaymentAccountForInvoice(invoice);

    const disputeContext = await this.disputesService.getInvoiceDisputeContext(
      invoice,
    );

    return {
      data: {
        ...this.toInvoiceResponse(invoice, invoice.seller, paymentAccount, {
          viewerRole: isSeller ? 'seller' : 'buyer',
        }).data,
        ...disputeContext,
      },
    };
  }

  async getPublicPaymentView(shareToken: string) {
    const invoice = await this.invoicesRepository.findOne({
      where: { shareToken },
      relations: { seller: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status === 'cancelled') {
      throw new BadRequestException('This invoice has been cancelled');
    }

    const paymentAccount =
      await this.escrowSettlement.getPaymentAccountForInvoice(invoice);

    if (!paymentAccount) {
      throw new BadRequestException(
        'Payment account is not available for this invoice',
      );
    }

    // Seller must still be verified so payout destination exists under true hold.
    if (this.escrowSettlement.isTrueHoldEnabled()) {
      await this.assertVerifiedUser(invoice.sellerId);
    }

    return this.toPaymentView(invoice, invoice.seller, paymentAccount);
  }

  async initiatePayment(user: User | null, invoiceId: string) {
    if (!user) {
      throw new ForbiddenException('Sign in to initiate payment for this invoice');
    }

    const invoice = await this.findInvoiceOrThrow(invoiceId);

    this.assertBuyerAccess(user, invoice);

    return this.markPaymentInitiated(invoice);
  }

  async initiatePaymentByShareToken(shareToken: string) {
    const invoice = await this.invoicesRepository.findOne({
      where: { shareToken },
      relations: { seller: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return this.markPaymentInitiated(invoice);
  }

  async confirmReceipt(
    user: User,
    invoiceId: string,
    dto: ConfirmReceiptDto,
  ) {
    const invoice = await this.findInvoiceOrThrow(invoiceId);
    this.assertBuyerAccess(user, invoice);
    return this.releaseEscrow(invoice, dto);
  }

  async confirmReceiptByEmail(
    invoiceId: string,
    buyerEmail: string,
    dto: ConfirmReceiptDto,
  ) {
    const invoice = await this.findInvoiceOrThrow(invoiceId);
    if (invoice.buyerEmail.toLowerCase() !== buyerEmail.trim().toLowerCase()) {
      throw new ForbiddenException(
        'confirmedBy must match the transaction buyer email',
      );
    }
    return this.releaseEscrow(invoice, dto);
  }

  private async releaseEscrow(invoice: Invoice, dto: ConfirmReceiptDto) {
    if (invoice.status === 'released' || invoice.status === 'paid') {
      throw new BadRequestException('You have already confirmed receipt for this invoice');
    }

    if (invoice.status === 'disputed') {
      throw new BadRequestException(
        'This invoice is under dispute and cannot be confirmed until resolved',
      );
    }

    if (invoice.status !== 'paid_in_escrow') {
      throw new BadRequestException(
        'Payment must be received and held in escrow before you can confirm receipt',
      );
    }

    if (await this.ensureDeliveryOtp(invoice)) {
      await this.invoicesRepository.save(invoice);
    }

    const submittedOtp = dto.deliveryOtp.trim();
    if (!invoice.deliveryOtpCode || invoice.deliveryOtpCode !== submittedOtp) {
      throw new BadRequestException(
        'Invalid delivery OTP. Ask the seller or courier for the code shown on their invoice.',
      );
    }

    const settled = await this.escrowSettlement.payoutToSeller(invoice);

    const now = new Date();
    settled.status = 'released';
    settled.buyerConfirmedAt = now;
    settled.releasedAt = now;
    settled.deliveryOtpCode = null;
    settled.deliveryConfirmedLatitude =
      dto.latitude != null && Number.isFinite(dto.latitude) ? dto.latitude : null;
    settled.deliveryConfirmedLongitude =
      dto.longitude != null && Number.isFinite(dto.longitude)
        ? dto.longitude
        : null;
    settled.deliveryConfirmedAccuracy =
      dto.locationAccuracy != null && Number.isFinite(dto.locationAccuracy)
        ? dto.locationAccuracy
        : null;
    if (!settled.paidAt) {
      settled.paidAt = settled.escrowedAt ?? now;
    }
    await this.invoicesRepository.save(settled);

    await this.notificationsService.notifyInvoiceReleased(
      settled,
      settled.seller,
    );

    await this.webhooksService?.emitInvoiceEvent('receiver.confirmed', settled, {
      deliveryProof: {
        otpVerified: true,
        location: this.toDeliveryLocation(settled),
      },
    });
    await this.webhooksService?.emitInvoiceEvent('escrow.released', settled, {
      reason: 'receiver_confirmed',
      payoutStatus: settled.payoutStatus,
      payoutReference: settled.payoutReference,
    });

    const dva = await this.accountsService.findActiveVirtualAccount(
      settled.sellerId,
    );

    const payoutNote =
      settled.payoutStatus === 'failed'
        ? ' Confirmation recorded, but seller payout failed and will need retry.'
        : settled.payoutStatus === 'processing'
          ? ' Seller payout has been queued.'
          : '';

    return {
      message: `Receipt confirmed with delivery OTP. Funds have been released to the seller.${payoutNote}`,
      ...this.toInvoiceResponse(settled, settled.seller, dva, {
        viewerRole: 'buyer',
      }),
    };
  }

  private isPaymentSettled(status: InvoiceStatus) {
    return (
      status === 'paid_in_escrow' ||
      status === 'disputed' ||
      status === 'released' ||
      status === 'paid'
    );
  }

  private async markPaymentInitiated(invoice: Invoice) {
    if (invoice.status === 'released' || invoice.status === 'paid') {
      throw new BadRequestException('This invoice has already been paid');
    }

    if (invoice.status === 'cancelled') {
      throw new BadRequestException('This invoice has been cancelled');
    }

    if (invoice.status === 'disputed') {
      throw new BadRequestException('This invoice is under dispute');
    }

    if (invoice.status === 'paid_in_escrow') {
      throw new BadRequestException('This invoice has already been paid');
    }

    if (invoice.status !== 'payment_initiated') {
      invoice.status = 'payment_initiated';
      invoice.paymentInitiatedAt = new Date();
      await this.invoicesRepository.save(invoice);
      await this.webhooksService?.emitInvoiceEvent('payment.initiated', invoice);
    }

    const paymentAccount =
      await this.escrowSettlement.getPaymentAccountForInvoice(invoice);

    if (!paymentAccount) {
      throw new BadRequestException(
        this.escrowSettlement.isTrueHoldEnabled()
          ? 'Escrow collection account is not configured. Create an active virtual account on the admin user.'
          : 'Seller payment account is not available',
      );
    }

    if (this.escrowSettlement.isTrueHoldEnabled()) {
      await this.assertVerifiedUser(invoice.sellerId);
    }

    const seller =
      invoice.seller ?? (await this.usersService.findById(invoice.sellerId));

    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    return {
      message: this.escrowSettlement.isTrueHoldEnabled()
        ? 'Payment initiated. Transfer the exact amount to the Amana escrow account. Funds stay held until you confirm receipt.'
        : 'Payment initiated. Transfer the exact amount using the account details provided. Funds will be held in escrow until you confirm receipt of your items.',
      data: this.toPaymentView(invoice, seller, paymentAccount),
    };
  }

  private async assertVerifiedUser(userId: string) {
    const verified = await this.usersService.isVerified(userId);
    if (!verified) {
      throw new ForbiddenException(
        'Complete verification and create a virtual account before using invoices',
      );
    }
  }

  private async findInvoiceOrThrow(invoiceId: string): Promise<Invoice> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id: invoiceId },
      relations: { seller: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  private assertInvoiceAccess(user: User, invoice: Invoice) {
    const isSeller = invoice.sellerId === user.id;
    const isBuyer =
      invoice.buyerEmail.toLowerCase() === user.email.toLowerCase();

    if (!isSeller && !isBuyer) {
      throw new ForbiddenException('You do not have access to this invoice');
    }
  }

  private assertBuyerAccess(user: User, invoice: Invoice) {
    if (invoice.buyerEmail.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('Only the invoice recipient can initiate payment');
    }
  }

  async applyPaymentFromWebhook(input: {
    paymentReference: string;
    amount: number;
    status: string;
    chargeId?: string | null;
    chargeReference?: string | null;
  }) {
    const paymentReference = input.paymentReference.trim().toUpperCase();
    const invoice = await this.invoicesRepository.findOne({
      where: { paymentReference },
      relations: { seller: true },
    });

    if (!invoice) {
      return { matched: false as const };
    }

    if (input.status !== 'succeeded') {
      return {
        matched: true as const,
        updated: false as const,
        invoiceId: invoice.id,
      };
    }

    if (this.isPaymentSettled(invoice.status)) {
      return {
        matched: true as const,
        updated: false as const,
        invoiceId: invoice.id,
      };
    }

    const expected = Number(invoice.amount);
    if (Math.abs(expected - input.amount) > 0.01) {
      throw new BadRequestException(
        `Payment amount does not match invoice ${invoice.invoiceNumber}`,
      );
    }

    const now = new Date();
    invoice.status = 'paid_in_escrow';
    invoice.escrowedAt = now;
    invoice.paidAt = now;
    invoice.deliveryOtpCode = this.generateDeliveryOtp();
    invoice.flutterwaveChargeId = input.chargeId ?? invoice.flutterwaveChargeId;
    invoice.flutterwaveChargeReference =
      input.chargeReference ?? invoice.flutterwaveChargeReference;
    await this.invoicesRepository.save(invoice);

    await this.notificationsService.notifyInvoiceEscrowed(invoice, invoice.seller);
    await this.webhooksService?.emitInvoiceEvent('payment.funded', invoice, {
      trueHold: this.escrowSettlement.isTrueHoldEnabled(),
      deliveryOtp: invoice.deliveryOtpCode,
      requiresDeliveryOtp: true,
    });

    return {
      matched: true as const,
      updated: true as const,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
    };
  }

  private generateInvoiceNumber(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = randomBytes(3).toString('hex').toUpperCase();
    return `INV-${date}-${suffix}`;
  }

  private generatePaymentReference(): string {
    return `PAY-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private generateDeliveryOtp(): string {
    return String(randomInt(100000, 1000000));
  }

  /** Backfill OTP for invoices escrowed before delivery proof shipped. */
  private async ensureDeliveryOtp(invoice: Invoice): Promise<boolean> {
    if (invoice.deliveryOtpCode) {
      return false;
    }

    if (
      invoice.status !== 'paid_in_escrow' &&
      invoice.status !== 'disputed'
    ) {
      return false;
    }

    invoice.deliveryOtpCode = this.generateDeliveryOtp();
    return true;
  }

  /** Persist a delivery OTP when escrow/disputed invoices are missing one. */
  async ensureDeliveryOtpPersisted(invoice: Invoice): Promise<Invoice> {
    if (await this.ensureDeliveryOtp(invoice)) {
      return this.invoicesRepository.save(invoice);
    }
    return invoice;
  }

  private toDeliveryLocation(invoice: Invoice) {
    if (
      invoice.deliveryConfirmedLatitude == null ||
      invoice.deliveryConfirmedLongitude == null ||
      !Number.isFinite(invoice.deliveryConfirmedLatitude) ||
      !Number.isFinite(invoice.deliveryConfirmedLongitude)
    ) {
      return null;
    }

    return {
      latitude: invoice.deliveryConfirmedLatitude,
      longitude: invoice.deliveryConfirmedLongitude,
      accuracy: invoice.deliveryConfirmedAccuracy,
    };
  }

  private toDeliveryProof(invoice: Invoice) {
    if (!invoice.buyerConfirmedAt) {
      return null;
    }

    return {
      confirmedAt: invoice.buyerConfirmedAt,
      otpVerified: true,
      location: this.toDeliveryLocation(invoice),
    };
  }

  private toInvoiceSummary(invoice: Invoice) {
    const seller = invoice.seller;

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      buyerEmail: invoice.buyerEmail,
      buyerName: invoice.buyerName,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      status: invoice.status,
      description: invoice.description,
      dueDate: invoice.dueDate,
      paymentReference: invoice.paymentReference,
      shareToken: invoice.shareToken,
      createdAt: invoice.createdAt,
      seller: seller
        ? {
            name: `${seller.firstname} ${seller.lastname}`.trim(),
            email: seller.email,
          }
        : null,
    };
  }

  private toInvoiceResponse(
    invoice: Invoice,
    seller: User,
    dva: { accountNumber: string; bankName: string; accountStatus: string } | null,
    options?: { viewerRole?: 'seller' | 'buyer' },
  ) {
    const viewerRole = options?.viewerRole;
    const showDeliveryOtp =
      viewerRole === 'seller' &&
      Boolean(invoice.deliveryOtpCode) &&
      (invoice.status === 'paid_in_escrow' || invoice.status === 'disputed');

    return {
      data: {
        ...this.toInvoiceSummary(invoice),
        paymentInitiatedAt: invoice.paymentInitiatedAt,
        paidAt: invoice.paidAt,
        escrowedAt: invoice.escrowedAt,
        buyerConfirmedAt: invoice.buyerConfirmedAt,
        releasedAt: invoice.releasedAt,
        requiresDeliveryOtp:
          invoice.status === 'paid_in_escrow' && Boolean(invoice.deliveryOtpCode),
        deliveryOtpCode: showDeliveryOtp ? invoice.deliveryOtpCode : null,
        deliveryProof: this.toDeliveryProof(invoice),
        seller: {
          name: `${seller.firstname} ${seller.lastname}`.trim(),
          email: seller.email,
        },
        paymentAccount: dva
          ? {
              accountNumber: dva.accountNumber,
              bankName: dva.bankName,
              accountStatus: dva.accountStatus,
            }
          : null,
        paymentUrl: `/pay/${invoice.shareToken}`,
      },
    };
  }

  private toPaymentView(
    invoice: Invoice,
    seller: User,
    paymentAccount: {
      accountNumber: string;
      bankName: string;
      accountStatus?: string;
      holderName?: string | null;
      isPlatformEscrow?: boolean;
    },
  ) {
    return {
      data: {
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          amount: Number(invoice.amount),
          currency: invoice.currency,
          description: invoice.description,
          status: invoice.status,
          buyerName: invoice.buyerName,
          dueDate: invoice.dueDate,
          paymentReference: invoice.paymentReference,
          successUrl: invoice.successUrl,
          cancelUrl: invoice.cancelUrl,
        },
        seller: {
          name: `${seller.firstname} ${seller.lastname}`.trim(),
        },
        payment: {
          accountNumber: paymentAccount.accountNumber,
          bankName: paymentAccount.bankName,
          accountStatus: paymentAccount.accountStatus ?? 'active',
          holderName: paymentAccount.holderName ?? null,
          isPlatformEscrow: Boolean(paymentAccount.isPlatformEscrow),
          amount: Number(invoice.amount),
          currency: invoice.currency,
          paymentReference: invoice.paymentReference,
          narration: invoice.paymentReference,
        },
      },
    };
  }
}
