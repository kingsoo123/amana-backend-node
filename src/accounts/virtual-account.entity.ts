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
import { BvnVerification } from './bvn-verification.entity';

@Entity('virtual_accounts')
export class VirtualAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'account_number', type: 'varchar' })
  accountNumber: string;

  @Column({ name: 'bank_name', type: 'varchar' })
  bankName: string;

  @Column({ name: 'bank_code', type: 'varchar', nullable: true })
  bankCode: string | null;

  @Column({ name: 'flw_ref', type: 'varchar', nullable: true })
  flwRef: string | null;

  @Column({ name: 'order_ref', type: 'varchar', nullable: true })
  orderRef: string | null;

  @Column({ name: 'tx_ref', type: 'varchar' })
  txRef: string;

  @Column({ name: 'account_status', type: 'varchar', default: 'pending' })
  accountStatus: string;

  @Column({ name: 'account_type', type: 'varchar', default: 'static' })
  accountType: string;

  @Column({ name: 'bvn_verification_id', type: 'uuid', nullable: true })
  bvnVerificationId: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', nullable: true, unique: true })
  idempotencyKey: string | null;

  @ManyToOne(() => BvnVerification, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'bvn_verification_id' })
  bvnVerification: BvnVerification | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
