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

@Entity('bvn_verifications')
export class BvnVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 11 })
  bvn: string;

  @Column({ type: 'varchar' })
  reference: string;

  @Column({ name: 'consent_url', type: 'varchar', nullable: true })
  consentUrl: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: string;

  @Column({ name: 'api_mode', type: 'varchar', default: 'v4' })
  apiMode: string;

  @Column({ name: 'requires_consent', type: 'boolean', default: false })
  requiresConsent: boolean;

  @Column({ name: 'verified_first_name', type: 'varchar', nullable: true })
  verifiedFirstName: string | null;

  @Column({ name: 'verified_last_name', type: 'varchar', nullable: true })
  verifiedLastName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
