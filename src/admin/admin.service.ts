import {
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute } from '../disputes/dispute.entity';
import { DisputesService } from '../disputes/disputes.service';
import { Invoice } from '../invoices/invoice.entity';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AdminResolveDisputeDto } from '../disputes/dto/admin-resolve-dispute.dto';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    @InjectRepository(Dispute)
    private readonly disputesRepository: Repository<Dispute>,
    private readonly usersService: UsersService,
    private readonly disputesService: DisputesService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    if (adminEmail) {
      await this.usersService.promoteAdminByEmail(adminEmail);
    }
  }

  async getOverview() {
    const [userCount, invoiceCount, openDisputes, disputedInvoices] =
      await Promise.all([
        this.usersRepository.count(),
        this.invoicesRepository.count(),
        this.disputesRepository.count({
          where: [{ status: 'open' }, { status: 'under_review' }],
        }),
        this.invoicesRepository.count({ where: { status: 'disputed' } }),
      ]);

    const invoices = await this.invoicesRepository.find();
    let totalVolume = 0;
    let escrowVolume = 0;
    let releasedVolume = 0;

    for (const invoice of invoices) {
      if (invoice.status === 'cancelled') {
        continue;
      }

      const amount = Number(invoice.amount);
      totalVolume += amount;

      if (invoice.status === 'paid_in_escrow' || invoice.status === 'disputed') {
        escrowVolume += amount;
      }

      if (invoice.status === 'released' || invoice.status === 'paid') {
        releasedVolume += amount;
      }
    }

    return {
      data: {
        userCount,
        invoiceCount,
        openDisputes,
        disputedInvoices,
        totalVolume,
        escrowVolume,
        releasedVolume,
      },
    };
  }

  async listUsers() {
    const users = await this.usersService.listAll();

    const data = await Promise.all(
      users.map(async (user) => ({
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role,
        verified: await this.usersService.isVerified(user.id),
        createdAt: user.createdAt,
      })),
    );

    return { data };
  }

  async updateUserRole(userId: string, role: User['role']) {
    const user = await this.usersService.setRole(userId, role);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      message: 'User role updated',
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  async listInvoices() {
    const invoices = await this.invoicesRepository.find({
      relations: { seller: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });

    return {
      data: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        buyerEmail: invoice.buyerEmail,
        buyerName: invoice.buyerName,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        status: invoice.status,
        createdAt: invoice.createdAt,
        seller: invoice.seller
          ? {
              id: invoice.seller.id,
              name: `${invoice.seller.firstname} ${invoice.seller.lastname}`.trim(),
              email: invoice.seller.email,
            }
          : null,
      })),
    };
  }

  listDisputes(status?: string) {
    return this.disputesService.listAll(status);
  }

  resolveDispute(admin: User, disputeId: string, dto: AdminResolveDisputeDto) {
    return this.disputesService.adminResolve(admin, disputeId, dto);
  }
}
