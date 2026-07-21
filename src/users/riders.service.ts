import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { NearbyRidersQueryDto } from './dto/nearby-riders-query.dto';
import { UpdateRiderEngagementDto } from './dto/update-rider-engagement.dto';
import { UpdateRiderPresenceDto } from './dto/update-rider-presence.dto';
import { User } from './user.entity';
import { UsersService } from './users.service';

/** Invoices that keep a rider engaged until release/cancel. */
const ENGAGED_INVOICE_STATUSES = [
  'pending',
  'payment_initiated',
  'paid_in_escrow',
  'disputed',
] as const;

/** Statuses a rider may lock onto when toggling Engaged. */
const ENGAGEABLE_INVOICE_STATUSES = [
  'pending',
  'payment_initiated',
  'paid_in_escrow',
] as const;

@Injectable()
export class RidersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    private readonly usersService: UsersService,
  ) {}

  async updatePresence(user: User, dto: UpdateRiderPresenceDto) {
    if (user.role !== 'rider') {
      throw new ForbiddenException('Only rider accounts can update presence');
    }

    const verified = await this.usersService.isVerified(user.id);
    if (dto.isOnline && !verified) {
      throw new BadRequestException(
        'Complete rider verification before going online',
      );
    }

    const latitude = dto.latitude;
    const longitude = dto.longitude;

    if (dto.isOnline) {
      if (
        latitude == null ||
        longitude == null ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        throw new BadRequestException(
          'Location is required to go online. Allow GPS access and try again.',
        );
      }
    }

    await this.usersRepository.update(
      { id: user.id },
      {
        isOnline: dto.isOnline,
        ...(dto.isOnline
          ? {
              lastLatitude: latitude!,
              lastLongitude: longitude!,
              lastLocationAt: new Date(),
            }
          : {}),
      },
    );

    const refreshed = await this.usersRepository.findOne({
      where: { id: user.id },
    });

    return {
      data: {
        isOnline: refreshed?.isOnline ?? dto.isOnline,
        isEngaged: refreshed?.isEngaged ?? false,
        latitude: refreshed?.lastLatitude ?? null,
        longitude: refreshed?.lastLongitude ?? null,
        lastLocationAt: refreshed?.lastLocationAt ?? null,
      },
      message: dto.isOnline
        ? 'You are online and visible to nearby sellers'
        : 'You are offline',
    };
  }

  async updateEngagement(user: User, dto: UpdateRiderEngagementDto) {
    if (user.role !== 'rider') {
      throw new ForbiddenException('Only rider accounts can update engagement');
    }

    if (!dto.isEngaged) {
      await this.usersRepository.update(
        { id: user.id },
        { isEngaged: false, engagedInvoiceId: null },
      );

      return {
        data: {
          isEngaged: false,
          isOnline: user.isOnline,
          engagedInvoiceId: null,
          invoice: null,
        },
        message: 'Marked as available — sellers can assign you again',
      };
    }

    const reference = dto.invoiceReference?.trim().toUpperCase();
    if (!reference) {
      throw new BadRequestException(
        'Enter the seller invoice number or payment reference to go engaged',
      );
    }

    const invoice = await this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.seller', 'seller')
      .where(
        '(UPPER(invoice.invoice_number) = :reference OR UPPER(invoice.payment_reference) = :reference)',
        { reference },
      )
      .getOne();

    if (!invoice) {
      throw new BadRequestException(
        'No invoice found for that reference. Check the invoice number from the seller.',
      );
    }

    if (invoice.status === 'disputed') {
      throw new BadRequestException(
        'This invoice is in dispute and cannot be used to go engaged',
      );
    }

    if (invoice.status === 'released' || invoice.status === 'paid') {
      throw new BadRequestException(
        'This invoice has already been released or paid and cannot be used to go engaged',
      );
    }

    if (invoice.status === 'cancelled') {
      throw new BadRequestException('This invoice is cancelled');
    }

    if (
      !ENGAGEABLE_INVOICE_STATUSES.includes(
        invoice.status as (typeof ENGAGEABLE_INVOICE_STATUSES)[number],
      )
    ) {
      throw new BadRequestException(
        'Only open invoices (not disputed or released) can be used to go engaged',
      );
    }

    if (invoice.assignedRiderId && invoice.assignedRiderId !== user.id) {
      throw new BadRequestException(
        'This invoice is already assigned to another rider',
      );
    }

    if (!invoice.assignedRiderId) {
      invoice.assignedRiderId = user.id;
      await this.invoicesRepository.save(invoice);
    }

    await this.usersRepository.update(
      { id: user.id },
      { isEngaged: true, engagedInvoiceId: invoice.id },
    );

    return {
      data: {
        isEngaged: true,
        isOnline: user.isOnline,
        engagedInvoiceId: invoice.id,
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          paymentReference: invoice.paymentReference,
          status: invoice.status,
          buyerName: invoice.buyerName,
          amount: Number(invoice.amount),
          currency: invoice.currency,
        },
      },
      message: `Engaged on ${invoice.invoiceNumber} — you will not appear for new jobs`,
    };
  }

  async listNearbyAvailable(query: NearbyRidersQueryDto) {
    const radiusKm = query.radiusKm ?? 2;
    const riders = await this.usersRepository.find({
      where: { role: 'rider' },
      order: { updatedAt: 'DESC' },
      take: 80,
    });

    const riderIds = riders.map((rider) => rider.id);
    const engagedIds = new Set(
      riderIds.length === 0
        ? []
        : (
            await this.invoicesRepository.find({
              where: {
                assignedRiderId: In(riderIds),
                status: In([...ENGAGED_INVOICE_STATUSES]),
              },
              select: { assignedRiderId: true },
            })
          )
            .map((invoice) => invoice.assignedRiderId)
            .filter((id): id is string => Boolean(id)),
    );

    type Candidate = {
      rider: User;
      distanceKm: number;
      verified: boolean;
      isOnline: boolean;
    };

    const candidates: Candidate[] = [];

    for (const rider of riders) {
      if (rider.isEngaged || engagedIds.has(rider.id)) continue;
      if (!rider.isOnline) continue;
      if (rider.lastLatitude == null || rider.lastLongitude == null) continue;

      const verified = await this.usersService.isVerified(rider.id);
      if (!verified) continue;

      const distanceKm = this.haversineKm(
        query.lat,
        query.lng,
        rider.lastLatitude,
        rider.lastLongitude,
      );

      candidates.push({
        rider,
        distanceKm,
        verified,
        isOnline: true,
      });
    }

    const nearby = candidates
      .filter((entry) => entry.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return {
      data: nearby.slice(0, 20).map(({ rider, distanceKm, verified, isOnline }) => {
        const etaMinutes = this.estimateEtaMinutes(
          distanceKm,
          rider.vehicleTypes ?? [],
        );
        return {
          id: rider.id,
          displayName: `${rider.firstname} ${rider.lastname}`.trim(),
          phoneNumber: rider.phoneNumber,
          vehicleTypes: rider.vehicleTypes ?? [],
          profilePhotoUrl: rider.profilePhotoUrl,
          verified,
          isOnline,
          isEngaged: false,
          distanceKm: Number(distanceKm.toFixed(2)),
          etaMinutes,
        };
      }),
      meta: {
        lat: query.lat,
        lng: query.lng,
        radiusKm,
        count: nearby.length,
      },
    };
  }

  async assertAssignableRider(riderId: string) {
    const rider = await this.usersRepository.findOne({
      where: { id: riderId, role: 'rider' },
    });
    if (!rider) {
      throw new BadRequestException('Selected rider was not found');
    }

    const verified = await this.usersService.isVerified(rider.id);
    if (!verified) {
      throw new BadRequestException('Selected rider is not verified yet');
    }

    if (rider.isEngaged) {
      throw new BadRequestException('Selected rider is currently engaged');
    }

    const engaged = await this.invoicesRepository.exists({
      where: {
        assignedRiderId: rider.id,
        status: In([...ENGAGED_INVOICE_STATUSES]),
      },
    });
    if (engaged) {
      throw new BadRequestException(
        'Selected rider is already on another delivery',
      );
    }

    return rider;
  }

  /** Clear engagement when an invoice is cancelled or otherwise closed. */
  async clearEngagementForInvoice(invoiceId: string) {
    await this.usersRepository.update(
      { engagedInvoiceId: invoiceId },
      { isEngaged: false, engagedInvoiceId: null },
    );
  }

  toRiderSummary(rider: User | null | undefined) {
    if (!rider) return null;
    return {
      id: rider.id,
      displayName: `${rider.firstname} ${rider.lastname}`.trim(),
      phoneNumber: rider.phoneNumber,
      vehicleTypes: rider.vehicleTypes ?? [],
      profilePhotoUrl: rider.profilePhotoUrl,
    };
  }

  /** Live map data for the rider's engaged invoice → buyer dropoff. */
  async getEngagedTracking(user: User) {
    if (user.role !== 'rider') {
      throw new ForbiddenException('Only rider accounts can view delivery tracking');
    }

    const rider = await this.usersRepository.findOne({ where: { id: user.id } });
    if (!rider) {
      throw new ForbiddenException('Rider account not found');
    }

    if (!rider.isEngaged || !rider.engagedInvoiceId) {
      return {
        data: {
          isEngaged: false,
          invoice: null,
          rider: null,
          buyer: null,
          distanceKm: null,
          etaMinutes: null,
        },
      };
    }

    const invoice = await this.invoicesRepository.findOne({
      where: { id: rider.engagedInvoiceId },
    });

    if (!invoice) {
      return {
        data: {
          isEngaged: true,
          invoice: null,
          rider: this.toTrackingPoint(
            rider.lastLatitude,
            rider.lastLongitude,
            rider.lastLocationAt,
          ),
          buyer: null,
          distanceKm: null,
          etaMinutes: null,
        },
      };
    }

    const riderPoint = this.toTrackingPoint(
      rider.lastLatitude,
      rider.lastLongitude,
      rider.lastLocationAt,
    );
    const buyerPoint = this.toTrackingPoint(
      invoice.buyerLatitude,
      invoice.buyerLongitude,
      invoice.buyerLocationAt,
    );

    let distanceKm: number | null = null;
    let etaMinutes: number | null = null;

    if (
      riderPoint &&
      buyerPoint &&
      Number.isFinite(riderPoint.latitude) &&
      Number.isFinite(riderPoint.longitude) &&
      Number.isFinite(buyerPoint.latitude) &&
      Number.isFinite(buyerPoint.longitude)
    ) {
      distanceKm = Number(
        this.haversineKm(
          riderPoint.latitude,
          riderPoint.longitude,
          buyerPoint.latitude,
          buyerPoint.longitude,
        ).toFixed(2),
      );
      etaMinutes = this.estimateEtaMinutes(
        distanceKm,
        rider.vehicleTypes ?? [],
      );
    }

    return {
      data: {
        isEngaged: true,
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          paymentReference: invoice.paymentReference,
          status: invoice.status,
          buyerName: invoice.buyerName,
          amount: Number(invoice.amount),
          currency: invoice.currency,
        },
        rider: riderPoint,
        buyer: buyerPoint,
        distanceKm,
        etaMinutes,
      },
    };
  }

  private toTrackingPoint(
    latitude: number | null | undefined,
    longitude: number | null | undefined,
    updatedAt: Date | null | undefined,
  ) {
    if (
      latitude == null ||
      longitude == null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }
    return {
      latitude,
      longitude,
      updatedAt: updatedAt ?? null,
    };
  }

  private haversineKm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Rough urban ETA from seller pin → rider pin, by fastest vehicle type. */
  private estimateEtaMinutes(
    distanceKm: number,
    vehicleTypes: Array<'bike' | 'car' | 'truck' | 'van'>,
  ): number {
    const speedsKmh: Record<'bike' | 'car' | 'truck' | 'van', number> = {
      bike: 22,
      car: 28,
      van: 24,
      truck: 18,
    };
    const speed =
      vehicleTypes.length > 0
        ? Math.max(...vehicleTypes.map((type) => speedsKmh[type] ?? 22))
        : 22;
    const minutes = Math.ceil((distanceKm / speed) * 60);
    return Math.max(1, minutes);
  }
}
