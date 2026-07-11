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
import { Partner } from './partner.entity';

export type PartnerAccessRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected';

@Entity('partner_access_requests')
export class PartnerAccessRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  @Column({ name: 'business_name', type: 'varchar' })
  businessName: string;

  @Column({ name: 'webhook_url', type: 'varchar', nullable: true })
  webhookUrl: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: PartnerAccessRequestStatus;

  @Column({ name: 'reviewed_by_admin_id', type: 'uuid', nullable: true })
  reviewedByAdminId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewed_by_admin_id' })
  reviewedByAdmin: User | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes: string | null;

  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId: string | null;

  @ManyToOne(() => Partner, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'partner_id' })
  partner: Partner | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
