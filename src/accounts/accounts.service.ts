import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FlutterwaveService } from '../flutterwave/flutterwave.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { BvnVerification } from './bvn-verification.entity';
import { ConfirmBvnDto } from './dto/confirm-bvn.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { InitiateBvnDto } from './dto/initiate-bvn.dto';
import { VirtualAccount } from './virtual-account.entity';

const ACTIVE_STATUSES = new Set(['active']);
const COMPLETED_BVN_STATUSES = new Set([
  'COMPLETED',
  'SUCCESS',
  'SUCCESSFUL',
  'COLLECTED',
  'collected',
  'completed',
]);

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(VirtualAccount)
    private readonly virtualAccountsRepository: Repository<VirtualAccount>,
    @InjectRepository(BvnVerification)
    private readonly bvnVerificationsRepository: Repository<BvnVerification>,
    private readonly flutterwaveService: FlutterwaveService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async getAccountStatus(userId: string) {
    const bvnVerification = await this.findLatestBvnVerification(userId);
    const virtualAccount = await this.findActiveVirtualAccount(userId);

    return {
      bvn: bvnVerification
        ? {
            status: bvnVerification.status,
            maskedBvn: this.maskBvn(bvnVerification.bvn),
            reference: bvnVerification.reference,
            verifiedFirstName: bvnVerification.verifiedFirstName,
            verifiedLastName: bvnVerification.verifiedLastName,
            requiresConsent: bvnVerification.requiresConsent,
            apiMode: bvnVerification.apiMode,
          }
        : null,
      dva: virtualAccount
        ? {
            accountNumber: virtualAccount.accountNumber,
            bankName: virtualAccount.bankName,
            accountStatus: virtualAccount.accountStatus,
            accountType: virtualAccount.accountType,
          }
        : null,
      verified: Boolean(virtualAccount),
    };
  }

  async initiateBvnVerification(user: User, dto: InitiateBvnDto) {
    const completed = await this.findCompletedBvnVerification(user.id);
    if (completed) {
      throw new ConflictException('BVN is already verified for this account');
    }

    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const redirectUrl = `${frontendUrl.replace(/\/$/, '')}/main/settings?bvn=callback`;

    const result = await this.flutterwaveService.initiateBvnVerification({
      bvn: dto.bvn,
      firstname: user.firstname,
      lastname: user.lastname,
      redirectUrl,
    });

    const initialStatus = result.requiresConsent ? 'pending' : 'collected';

    const verification = await this.bvnVerificationsRepository.save({
      userId: user.id,
      bvn: dto.bvn,
      reference: result.reference,
      consentUrl: result.consentUrl,
      status: initialStatus,
      apiMode: result.apiMode,
      requiresConsent: result.requiresConsent,
      verifiedFirstName: result.requiresConsent ? null : user.firstname,
      verifiedLastName: result.requiresConsent ? null : user.lastname,
    });

    return {
      message: result.requiresConsent
        ? 'BVN verification initiated'
        : 'BVN saved. You can now create your dedicated virtual account.',
      data: {
        reference: verification.reference,
        consentUrl: verification.consentUrl,
        status: verification.status,
        maskedBvn: this.maskBvn(verification.bvn),
        requiresConsent: verification.requiresConsent,
        completed: !verification.requiresConsent,
        apiMode: verification.apiMode,
      },
    };
  }

  async confirmBvnVerification(user: User, dto: ConfirmBvnDto) {
    const verification = dto.reference
      ? await this.bvnVerificationsRepository.findOne({
          where: { userId: user.id, reference: dto.reference },
        })
      : await this.findLatestBvnVerification(user.id);

    if (!verification) {
      throw new BadRequestException('No BVN verification request found');
    }

    const result = await this.flutterwaveService.confirmBvnVerification(
      verification.reference,
      verification.apiMode === 'v3' ? 'v3' : 'v4',
    );

    verification.status = result.status.toLowerCase();
    verification.verifiedFirstName = result.firstName;
    verification.verifiedLastName = result.lastName;

    await this.bvnVerificationsRepository.save(verification);

    const completed = COMPLETED_BVN_STATUSES.has(result.status.toUpperCase());

    return {
      message: completed
        ? 'BVN verified successfully'
        : 'BVN verification is still pending',
      data: {
        reference: verification.reference,
        status: verification.status,
        completed,
        maskedBvn: this.maskBvn(verification.bvn),
        verifiedFirstName: verification.verifiedFirstName,
        verifiedLastName: verification.verifiedLastName,
      },
    };
  }

  async createVirtualAccount(
    user: User,
    dto: CreateAccountDto,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return this.toAccountResponse(
          existing,
          await this.usersService.isVerified(user.id),
        );
      }
    }

    const activeAccount = await this.findActiveVirtualAccount(user.id);
    if (activeAccount) {
      throw new ConflictException('You already have an active virtual account');
    }

    const bvnVerification = await this.findCompletedBvnVerification(user.id);
    if (!bvnVerification) {
      throw new BadRequestException(
        'Complete BVN verification before creating a dedicated virtual account',
      );
    }

    const txRef = this.flutterwaveService.buildTxRef(user.id);

    let flutterwaveCustomerId = user.flutterwaveCustomerId;
    if (!flutterwaveCustomerId && this.flutterwaveService.getApiMode() === 'v4') {
      flutterwaveCustomerId = await this.flutterwaveService.ensureV4Customer({
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        phonenumber: user.phoneNumber,
        idempotencyKey,
      });
      await this.usersService.setFlutterwaveCustomerId(
        user.id,
        flutterwaveCustomerId,
      );
    }

    const flutterwaveAccount =
      await this.flutterwaveService.createStaticVirtualAccount({
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        phonenumber: user.phoneNumber,
        txRef,
        bvn: bvnVerification.bvn,
        narration:
          dto.narration?.trim() ||
          `${user.firstname} ${user.lastname}`.trim(),
        flutterwaveCustomerId,
        userId: user.id,
        idempotencyKey,
      });

    if (flutterwaveAccount.flutterwaveCustomerId) {
      await this.usersService.setFlutterwaveCustomerId(
        user.id,
        flutterwaveAccount.flutterwaveCustomerId,
      );
    }

    bvnVerification.status = 'completed';
    bvnVerification.verifiedFirstName =
      bvnVerification.verifiedFirstName ?? user.firstname;
    bvnVerification.verifiedLastName =
      bvnVerification.verifiedLastName ?? user.lastname;
    await this.bvnVerificationsRepository.save(bvnVerification);

    const virtualAccount = await this.virtualAccountsRepository.save({
      userId: user.id,
      accountNumber: flutterwaveAccount.accountNumber,
      bankName: flutterwaveAccount.bankName,
      flwRef: flutterwaveAccount.flwRef,
      orderRef: flutterwaveAccount.orderRef,
      txRef,
      accountStatus: flutterwaveAccount.accountStatus,
      accountType: 'static',
      bvnVerificationId: bvnVerification.id,
      idempotencyKey: idempotencyKey ?? null,
    });

    const verified = ACTIVE_STATUSES.has(
      flutterwaveAccount.accountStatus.toLowerCase(),
    );

    if (verified) {
      await this.usersService.setVerified(user.id, true);
    }

    return this.toAccountResponse(virtualAccount, verified);
  }

  findActiveVirtualAccount(userId: string): Promise<VirtualAccount | null> {
    return this.virtualAccountsRepository
      .createQueryBuilder('account')
      .where('account.user_id = :userId', { userId })
      .andWhere('LOWER(account.account_status) IN (:...statuses)', {
        statuses: [...ACTIVE_STATUSES],
      })
      .orderBy('account.created_at', 'DESC')
      .getOne();
  }

  findByIdempotencyKey(key: string): Promise<VirtualAccount | null> {
    return this.virtualAccountsRepository.findOne({
      where: { idempotencyKey: key },
    });
  }

  private findLatestBvnVerification(
    userId: string,
  ): Promise<BvnVerification | null> {
    return this.bvnVerificationsRepository.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  private async findCompletedBvnVerification(
    userId: string,
  ): Promise<BvnVerification | null> {
    const verifications = await this.bvnVerificationsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return (
      verifications.find((item) =>
        COMPLETED_BVN_STATUSES.has(item.status.toUpperCase()),
      ) ?? null
    );
  }

  private maskBvn(bvn: string): string {
    if (bvn.length < 4) {
      return bvn;
    }

    return `${'*'.repeat(bvn.length - 4)}${bvn.slice(-4)}`;
  }

  private toAccountResponse(account: VirtualAccount, verified: boolean) {
    return {
      message: 'Dedicated virtual account created successfully',
      verified,
      data: {
        accountNumber: account.accountNumber,
        bankName: account.bankName,
        accountStatus: account.accountStatus,
        accountType: account.accountType,
      },
    };
  }
}
