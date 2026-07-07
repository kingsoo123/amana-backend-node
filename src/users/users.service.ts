import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VirtualAccount } from '../accounts/virtual-account.entity';
import { User } from './user.entity';

const ACTIVE_STATUSES = new Set(['active']);

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(VirtualAccount)
    private readonly virtualAccountsRepository: Repository<VirtualAccount>,
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
      .where('user.id != :excludeUserId', { excludeUserId });

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
  }): Promise<User> {
    const user = this.usersRepository.create(data);
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

  async isVerified(userId: string): Promise<boolean> {
    const account = await this.virtualAccountsRepository
      .createQueryBuilder('account')
      .where('account.user_id = :userId', { userId })
      .andWhere('LOWER(account.account_status) IN (:...statuses)', {
        statuses: [...ACTIVE_STATUSES],
      })
      .getOne();

    return Boolean(account);
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

  async promoteAdminByEmail(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      return;
    }

    await this.usersRepository.update({ email: normalized }, { role: 'admin' });
  }
}
