import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Partner } from '../partners/partner.entity';
import { User } from '../users/user.entity';
import { Dispute } from './dispute.entity';

export type DisputeMessageSenderKind = 'buyer' | 'admin' | 'partner';

@Entity('dispute_messages')
export class DisputeMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dispute_id', type: 'uuid' })
  disputeId: string;

  @ManyToOne(() => Dispute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute: Dispute;

  @Column({ name: 'sender_user_id', type: 'uuid', nullable: true })
  senderUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'sender_user_id' })
  sender: User | null;

  @Column({ name: 'sender_partner_id', type: 'uuid', nullable: true })
  senderPartnerId: string | null;

  @ManyToOne(() => Partner, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'sender_partner_id' })
  senderPartner: Partner | null;

  @Column({ name: 'sender_kind', type: 'varchar', length: 20, default: 'buyer' })
  senderKind: DisputeMessageSenderKind;

  @Column({ type: 'text', default: '' })
  body: string;

  @Column({ name: 'attachment_url', type: 'text', nullable: true })
  attachmentUrl: string | null;

  @Column({ name: 'attachment_public_id', type: 'varchar', nullable: true })
  attachmentPublicId: string | null;

  @Column({ name: 'attachment_resource_type', type: 'varchar', nullable: true })
  attachmentResourceType: string | null;

  @Column({ name: 'attachment_mime_type', type: 'varchar', nullable: true })
  attachmentMimeType: string | null;

  @Column({ name: 'attachment_file_name', type: 'varchar', nullable: true })
  attachmentFileName: string | null;

  @Column({ name: 'attachment_bytes', type: 'int', nullable: true })
  attachmentBytes: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
