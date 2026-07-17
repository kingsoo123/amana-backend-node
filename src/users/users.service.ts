import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VirtualAccount } from '../accounts/virtual-account.entity';
import { CloudinaryService } from '../media/cloudinary.service';
import { SaveProfilePhotoDto } from './dto/save-profile-photo.dto';
import { SignProfilePhotoUploadDto } from './dto/sign-profile-photo-upload.dto';
import { User } from './user.entity';

const ACTIVE_STATUSES = new Set(['active']);

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(VirtualAccount)
    private readonly virtualAccountsRepository: Repository<VirtualAccount>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email },
      select: {
        id: true,
        email: true,
        firstname: true,
        lastname: true,
        phoneNumber: true,
        passwordHash: true,
        verified: true,
        emailVerified: true,
        role: true,
        vehicleTypes: true,
        profilePhotoUrl: true,
        profilePhotoPublicId: true,
        flutterwaveCustomerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async isEmailVerified(userId: string): Promise<boolean> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, emailVerified: true },
    });

    return Boolean(user?.emailVerified);
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  searchBuyers(query: string, excludeUserId: string): Promise<User[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      return Promise.resolve([]);
    }

    const digits = trimmed.replace(/\D/g, '');
    const qb = this.usersRepository
      .createQueryBuilder('user')
      .where('user.id != :excludeUserId', { excludeUserId })
      .andWhere('user.role != :adminRole', { adminRole: 'admin' });

    if (trimmed.includes('@')) {
      qb.andWhere('LOWER(user.email) LIKE :email', {
        email: `%${trimmed.toLowerCase()}%`,
      });
    } else if (digits.length >= 4) {
      qb.andWhere(
        "REGEXP_REPLACE(user.phone_number, '[^0-9]', '', 'g') LIKE :phone",
        { phone: `%${digits}%` },
      );
    } else {
      const term = `%${trimmed.toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(user.email) LIKE :term OR LOWER(user.firstname) LIKE :term OR LOWER(user.lastname) LIKE :term OR LOWER(CONCAT(user.firstname, ' ', user.lastname)) LIKE :term)`,
        { term },
      );
    }

    return qb.orderBy('user.created_at', 'DESC').take(8).getMany();
  }

  create(data: {
    firstname: string;
    lastname: string;
    email: string;
    phoneNumber: string;
    passwordHash: string;
    role?: User['role'];
    vehicleTypes?: User['vehicleTypes'];
  }): Promise<User> {
    const user = this.usersRepository.create({
      ...data,
      role: data.role ?? 'user',
      vehicleTypes: data.vehicleTypes ?? null,
    });
    return this.usersRepository.save(user);
  }

  async setEmailVerified(userId: string, emailVerified: boolean): Promise<void> {
    await this.usersRepository.update({ id: userId }, { emailVerified });
  }

  async setVerified(userId: string, verified: boolean): Promise<void> {
    await this.usersRepository.update({ id: userId }, { verified });
  }

  async setFlutterwaveCustomerId(
    userId: string,
    customerId: string,
  ): Promise<void> {
    await this.usersRepository.update(
      { id: userId },
      { flutterwaveCustomerId: customerId },
    );
  }

  async hasActiveVirtualAccount(userId: string): Promise<boolean> {
    const account = await this.virtualAccountsRepository
      .createQueryBuilder('account')
      .where('account.user_id = :userId', { userId })
      .andWhere('LOWER(account.account_status) IN (:...statuses)', {
        statuses: [...ACTIVE_STATUSES],
      })
      .getOne();

    return Boolean(account);
  }

  /**
   * Sellers/users: active Flutterwave DVA.
   * Riders: profile photo + active DVA (payout destination).
   */
  async isVerified(userId: string): Promise<boolean> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, role: true, profilePhotoUrl: true },
    });
    if (!user) {
      return false;
    }

    const hasDva = await this.hasActiveVirtualAccount(userId);
    if (!hasDva) {
      return false;
    }

    if (user.role === 'rider') {
      return Boolean(user.profilePhotoUrl?.trim());
    }

    return true;
  }

  async syncVerifiedFlag(userId: string): Promise<boolean> {
    const verified = await this.isVerified(userId);
    await this.setVerified(userId, verified);
    return verified;
  }

  signProfilePhotoUpload(user: User, dto: SignProfilePhotoUploadDto) {
    return {
      data: this.cloudinaryService.signUpload({
        folder: `amana/riders/${user.id}/profile`,
        resourceType: dto.resourceType ?? 'image',
      }),
    };
  }

  async saveProfilePhoto(user: User, dto: SaveProfilePhotoDto) {
    const url = dto.url.trim();
    if (!this.cloudinaryService.isTrustedDeliveryUrl(url)) {
      throw new BadRequestException('Profile photo URL is not a trusted Cloudinary URL');
    }

    const expectedFolder = `amana/riders/${user.id}/profile`;
    if (dto.publicId?.trim() && !dto.publicId.trim().startsWith(expectedFolder)) {
      throw new BadRequestException('Profile photo public id is invalid for this account');
    }

    await this.usersRepository.update(
      { id: user.id },
      {
        profilePhotoUrl: url,
        profilePhotoPublicId: dto.publicId?.trim() || null,
      },
    );

    const verified = await this.syncVerifiedFlag(user.id);
    const refreshed = await this.findById(user.id);

    return {
      data: {
        profilePhotoUrl: refreshed?.profilePhotoUrl ?? url,
        profilePhotoPublicId: refreshed?.profilePhotoPublicId ?? null,
        verified,
      },
      message: verified
        ? 'Profile photo saved. Your rider account is verified.'
        : 'Profile photo saved. Complete BVN and DVA to finish verification.',
    };
  }

  listAdmins(): Promise<User[]> {
    return this.usersRepository.find({ where: { role: 'admin' } });
  }

  listAll(limit = 100): Promise<User[]> {
    return this.usersRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async setRole(userId: string, role: User['role']): Promise<User | null> {
    await this.usersRepository.update({ id: userId }, { role });
    return this.findById(userId);
  }

  /**
   * Opt a non-admin account into seller tools (invoices + partner access).
   * Buyers stay role=user until they enable selling or create an invoice.
   */
  async promoteToSeller(user: User): Promise<User> {
    if (user.role === 'admin') {
      throw new ForbiddenException(
        'Admin accounts cannot become sellers. Use a seller account instead.',
      );
    }

    if (user.role === 'seller') {
      return user;
    }

    await this.usersRepository.update({ id: user.id }, { role: 'seller' });
    const refreshed = await this.findById(user.id);
    if (!refreshed) {
      throw new ForbiddenException('Unable to enable seller access');
    }
    return refreshed;
  }

  assertSellerRole(user: User) {
    if (user.role === 'admin') {
      throw new ForbiddenException(
        'Admins manage partners via /api/v1/admin/partners, not /me/partner-access',
      );
    }

    if (user.role !== 'seller') {
      throw new ForbiddenException(
        'Seller access required. Enable selling on your account before using partner API tools.',
      );
    }
  }

  async promoteAdminByEmail(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      return;
    }

    await this.usersRepository.update({ email: normalized }, { role: 'admin' });
  }
}
