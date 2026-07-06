import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { User } from '../users/user.entity';

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'resolved_buyer'
  | 'resolved_seller'
  | 'closed';

export type DisputeReason =
  | 'items_not_received'
  | 'damaged_goods'
  | 'wrong_items'
  | 'not_as_described'
  | 'other';

@Entity('disputes')
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ name: 'raised_by_user_id', type: 'uuid' })
  raisedByUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'raised_by_user_id' })
  raisedBy: User;

  @Column({ type: 'varchar' })
  reason: DisputeReason;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', default: 'open' })
  status: DisputeStatus;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes: string | null;

  @Column({ name: 'resolved_by_admin_id', type: 'uuid', nullable: true })
  resolvedByAdminId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'resolved_by_admin_id' })
  resolvedByAdmin: User | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'seller_response_due_at', type: 'timestamptz', nullable: true })
  sellerResponseDueAt: Date | null;

  @Column({ name: 'platform_review_due_at', type: 'timestamptz', nullable: true })
  platformReviewDueAt: Date | null;

  @Column({ name: 'decision_due_at', type: 'timestamptz', nullable: true })
  decisionDueAt: Date | null;

  @Column({
    name: 'raised_latitude',
    type: 'double precision',
    nullable: true,
  })
  raisedLatitude: number | null;

  @Column({
    name: 'raised_longitude',
    type: 'double precision',
    nullable: true,
  })
  raisedLongitude: number | null;

  @Column({
    name: 'raised_location_accuracy',
    type: 'double precision',
    nullable: true,
  })
  raisedLocationAccuracy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
