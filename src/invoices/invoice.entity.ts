import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type InvoiceStatus =
  | 'pending'
  | 'payment_initiated'
  | 'paid_in_escrow'
  | 'disputed'
  | 'released'
  | 'paid'
  | 'cancelled';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_number', type: 'varchar', unique: true })
  invoiceNumber: string;

  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  @Column({ name: 'buyer_email', type: 'varchar' })
  buyerEmail: string;

  @Column({ name: 'buyer_name', type: 'varchar', nullable: true })
  buyerName: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', default: 'NGN' })
  currency: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: InvoiceStatus;

  @Column({ name: 'payment_reference', type: 'varchar', unique: true })
  paymentReference: string;

  @Column({ name: 'share_token', type: 'varchar', unique: true })
  shareToken: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: Date | null;

  @Column({ name: 'payment_initiated_at', type: 'timestamptz', nullable: true })
  paymentInitiatedAt: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'escrowed_at', type: 'timestamptz', nullable: true })
  escrowedAt: Date | null;

  @Column({ name: 'buyer_confirmed_at', type: 'timestamptz', nullable: true })
  buyerConfirmedAt: Date | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  /** Shared with seller/courier for handoff; cleared after buyer confirms. */
  @Column({ name: 'delivery_otp_code', type: 'varchar', length: 6, nullable: true })
  deliveryOtpCode: string | null;

  @Column({ name: 'delivery_confirmed_latitude', type: 'double precision', nullable: true })
  deliveryConfirmedLatitude: number | null;

  @Column({ name: 'delivery_confirmed_longitude', type: 'double precision', nullable: true })
  deliveryConfirmedLongitude: number | null;

  @Column({
    name: 'delivery_confirmed_accuracy',
    type: 'double precision',
    nullable: true,
  })
  deliveryConfirmedAccuracy: number | null;

  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId: string | null;

  @Column({ name: 'external_reference', type: 'varchar', nullable: true })
  externalReference: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'success_url', type: 'varchar', nullable: true })
  successUrl: string | null;

  @Column({ name: 'cancel_url', type: 'varchar', nullable: true })
  cancelUrl: string | null;

  @Column({ name: 'flutterwave_charge_id', type: 'varchar', nullable: true })
  flutterwaveChargeId: string | null;

  @Column({ name: 'flutterwave_charge_reference', type: 'varchar', nullable: true })
  flutterwaveChargeReference: string | null;

  /** not_required | pending | processing | completed | failed */
  @Column({ name: 'payout_status', type: 'varchar', nullable: true })
  payoutStatus: string | null;

  @Column({ name: 'payout_reference', type: 'varchar', nullable: true })
  payoutReference: string | null;

  @Column({ name: 'payout_transfer_id', type: 'varchar', nullable: true })
  payoutTransferId: string | null;

  @Column({ name: 'payout_at', type: 'timestamptz', nullable: true })
  payoutAt: Date | null;

  @Column({ name: 'payout_error', type: 'text', nullable: true })
  payoutError: string | null;

  /** not_required | processing | completed | failed */
  @Column({ name: 'refund_status', type: 'varchar', nullable: true })
  refundStatus: string | null;

  @Column({ name: 'refund_reference', type: 'varchar', nullable: true })
  refundReference: string | null;

  @Column({ name: 'refund_at', type: 'timestamptz', nullable: true })
  refundAt: Date | null;

  @Column({ name: 'refund_error', type: 'text', nullable: true })
  refundError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
