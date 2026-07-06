import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from '../invoices/invoice.entity';
import { UsersService } from '../users/users.service';

type CustomerAccumulator = {
  buyerEmail: string;
  buyerName: string | null;
  invoiceCount: number;
  totalInvoiced: number;
  fundsReleased: number;
  fundsInEscrow: number;
  outstanding: number;
  lastInvoiceAt: Date;
};

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    private readonly usersService: UsersService,
  ) {}

  async listCustomers(sellerId: string, query = '') {
    const verified = await this.usersService.isVerified(sellerId);
    if (!verified) {
      throw new ForbiddenException(
        'Complete verification before viewing your customer register',
      );
    }

    const invoices = await this.invoicesRepository.find({
      where: { sellerId },
      order: { createdAt: 'DESC' },
    });

    const active = invoices.filter((invoice) => invoice.status !== 'cancelled');
    const grouped = new Map<string, CustomerAccumulator>();

    for (const invoice of active) {
      const buyerEmail = invoice.buyerEmail.trim().toLowerCase();
      const amount = Number(invoice.amount);
      const existing = grouped.get(buyerEmail);

      const entry: CustomerAccumulator = existing ?? {
        buyerEmail,
        buyerName: invoice.buyerName,
        invoiceCount: 0,
        totalInvoiced: 0,
        fundsReleased: 0,
        fundsInEscrow: 0,
        outstanding: 0,
        lastInvoiceAt: invoice.createdAt,
      };

      if (!existing) {
        grouped.set(buyerEmail, entry);
      } else if (!entry.buyerName && invoice.buyerName) {
        entry.buyerName = invoice.buyerName;
      }

      if (invoice.createdAt > entry.lastInvoiceAt) {
        entry.lastInvoiceAt = invoice.createdAt;
      }

      entry.invoiceCount += 1;
      entry.totalInvoiced += amount;

      if (this.isReleased(invoice.status)) {
        entry.fundsReleased += amount;
      } else if (invoice.status === 'paid_in_escrow' || invoice.status === 'disputed') {
        entry.fundsInEscrow += amount;
      } else if (
        invoice.status === 'pending' ||
        invoice.status === 'payment_initiated'
      ) {
        entry.outstanding += amount;
      }
    }

    const searchTerm = query.trim().toLowerCase();
    let customers = [...grouped.values()];

    if (searchTerm) {
      customers = customers.filter((customer) => {
        const haystack = [
          customer.buyerEmail,
          customer.buyerName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(searchTerm);
      });
    }

    customers.sort(
      (left, right) =>
        right.lastInvoiceAt.getTime() - left.lastInvoiceAt.getTime(),
    );

    const enriched = await Promise.all(
      customers.map(async (customer) => {
        const user = await this.usersService.findByEmail(customer.buyerEmail);
        const displayName =
          customer.buyerName ??
          (user ? `${user.firstname} ${user.lastname}`.trim() : null) ??
          customer.buyerEmail;

        return {
          buyerEmail: customer.buyerEmail,
          buyerName: customer.buyerName,
          displayName,
          invoiceCount: customer.invoiceCount,
          totalInvoiced: customer.totalInvoiced,
          fundsReleased: customer.fundsReleased,
          fundsInEscrow: customer.fundsInEscrow,
          outstanding: customer.outstanding,
          lastInvoiceAt: customer.lastInvoiceAt.toISOString(),
          onPlatform: Boolean(user),
          phoneNumber: user?.phoneNumber ?? null,
        };
      }),
    );

    const summary = enriched.reduce(
      (totals, customer) => ({
        customerCount: totals.customerCount + 1,
        totalInvoiced: totals.totalInvoiced + customer.totalInvoiced,
        fundsReleased: totals.fundsReleased + customer.fundsReleased,
        fundsInEscrow: totals.fundsInEscrow + customer.fundsInEscrow,
        outstanding: totals.outstanding + customer.outstanding,
      }),
      {
        customerCount: 0,
        totalInvoiced: 0,
        fundsReleased: 0,
        fundsInEscrow: 0,
        outstanding: 0,
      },
    );

    return {
      data: enriched,
      summary,
    };
  }

  private isReleased(status: InvoiceStatus) {
    return status === 'released' || status === 'paid';
  }
}
