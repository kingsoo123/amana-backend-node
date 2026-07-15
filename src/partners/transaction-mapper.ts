import { Invoice, InvoiceStatus } from '../invoices/invoice.entity';
import { Dispute } from '../disputes/dispute.entity';

export type PartnerPaymentStatus =
  | 'Unpaid'
  | 'Initiated'
  | 'Escrow'
  | 'Locked'
  | 'Released'
  | 'Refunded';

export type PartnerDeliveryStatus = 'Not Started' | 'Unknown' | 'Confirmed';

export type PartnerFacingStatus =
  | 'Awaiting Payment'
  | 'Payment In Progress'
  | 'Awaiting Receiver Confirmation'
  | 'Disputed'
  | 'Completed'
  | 'Cancelled'
  | 'Refunded';

export function mapInvoiceStatus(status: InvoiceStatus): {
  status: PartnerFacingStatus;
  paymentStatus: PartnerPaymentStatus;
  deliveryStatus: PartnerDeliveryStatus;
} {
  switch (status) {
    case 'pending':
      return {
        status: 'Awaiting Payment',
        paymentStatus: 'Unpaid',
        deliveryStatus: 'Not Started',
      };
    case 'payment_initiated':
      return {
        status: 'Payment In Progress',
        paymentStatus: 'Initiated',
        deliveryStatus: 'Not Started',
      };
    case 'paid_in_escrow':
      return {
        status: 'Awaiting Receiver Confirmation',
        paymentStatus: 'Escrow',
        deliveryStatus: 'Unknown',
      };
    case 'disputed':
      return {
        status: 'Disputed',
        paymentStatus: 'Locked',
        deliveryStatus: 'Unknown',
      };
    case 'released':
    case 'paid':
      return {
        status: 'Completed',
        paymentStatus: 'Released',
        deliveryStatus: 'Confirmed',
      };
    case 'cancelled':
      return {
        status: 'Refunded',
        paymentStatus: 'Refunded',
        deliveryStatus: 'Unknown',
      };
    default:
      return {
        status: 'Awaiting Payment',
        paymentStatus: 'Unpaid',
        deliveryStatus: 'Not Started',
      };
  }
}

export function toPartnerTransaction(
  invoice: Invoice,
  options: {
    frontendBaseUrl: string;
    dispute?: Dispute | null;
  },
) {
  const mapped = mapInvoiceStatus(invoice.status);
  const checkoutUrl = `${options.frontendBaseUrl.replace(/\/$/, '')}/pay/${invoice.shareToken}`;
  const requiresDeliveryOtp =
    invoice.status === 'paid_in_escrow' || invoice.status === 'disputed';
  const deliveryOtp =
    requiresDeliveryOtp && invoice.deliveryOtpCode
      ? invoice.deliveryOtpCode
      : null;

  return {
    id: invoice.id,
    reference: invoice.invoiceNumber,
    status: mapped.status,
    paymentStatus: mapped.paymentStatus,
    deliveryStatus: mapped.deliveryStatus,
    amount: invoice.amount,
    currency: invoice.currency,
    description: invoice.description,
    checkoutUrl,
    confirmationUrl: checkoutUrl,
    successUrl: invoice.successUrl,
    cancelUrl: invoice.cancelUrl,
    externalReference: invoice.externalReference,
    metadata: invoice.metadata,
    /** True when POST …/confirm needs deliveryOtp (funds held / disputed). */
    requiresDeliveryOtp,
    /**
     * Active delivery OTP for courier handoff + server-side confirm.
     * Present only while requiresDeliveryOtp is true. Keep server-side.
     */
    deliveryOtp,
    buyer: {
      email: invoice.buyerEmail,
      name: invoice.buyerName,
    },
    timestamps: {
      createdAt: invoice.createdAt,
      paymentInitiatedAt: invoice.paymentInitiatedAt,
      fundedAt: invoice.escrowedAt,
      confirmedAt: invoice.buyerConfirmedAt,
      releasedAt: invoice.releasedAt,
    },
    dispute: options.dispute
      ? {
          id: options.dispute.id,
          status: options.dispute.status,
          reason: options.dispute.reason,
          createdAt: options.dispute.createdAt,
          resolvedAt: options.dispute.resolvedAt,
        }
      : null,
  };
}
