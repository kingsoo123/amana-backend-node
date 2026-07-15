import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'user' | 'seller' | 'admin';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'firstname' })
  firstname: string;

  @Column({ name: 'lastname' })
  lastname: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'phone_number' })
  phoneNumber: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ default: false })
  verified: boolean;

  @Column({ name: 'email_verified', default: false })
  emailVerified: boolean;

  @Column({ type: 'varchar', default: 'user' })
  role: UserRole;

  @Column({ name: 'flutterwave_customer_id', type: 'varchar', nullable: true })
  flutterwaveCustomerId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
