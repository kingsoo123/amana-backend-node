import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'user' | 'seller' | 'rider' | 'admin';

export type RiderVehicleType = 'bike' | 'car' | 'truck' | 'van';

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

  /** Set when role is rider — one or more of bike, car, truck, van. */
  @Column({ name: 'vehicle_types', type: 'simple-json', nullable: true })
  vehicleTypes: RiderVehicleType[] | null;

  /** Cloudinary delivery URL — required for rider account verification. */
  @Column({ name: 'profile_photo_url', type: 'varchar', nullable: true })
  profilePhotoUrl: string | null;

  @Column({ name: 'profile_photo_public_id', type: 'varchar', nullable: true })
  profilePhotoPublicId: string | null;

  @Column({ name: 'flutterwave_customer_id', type: 'varchar', nullable: true })
  flutterwaveCustomerId: string | null;

  /** Rider dispatch presence — sellers only see online, unengaged riders nearby. */
  @Column({ name: 'is_online', default: false })
  isOnline: boolean;

  /** Manual busy flag — when true, rider is hidden from seller nearby lists. */
  @Column({ name: 'is_engaged', default: false })
  isEngaged: boolean;

  /** Invoice the rider is currently engaged on (set when marking engaged). */
  @Column({ name: 'engaged_invoice_id', type: 'uuid', nullable: true })
  engagedInvoiceId: string | null;

  @Column({ name: 'last_latitude', type: 'double precision', nullable: true })
  lastLatitude: number | null;

  @Column({ name: 'last_longitude', type: 'double precision', nullable: true })
  lastLongitude: number | null;

  @Column({ name: 'last_location_at', type: 'timestamptz', nullable: true })
  lastLocationAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
