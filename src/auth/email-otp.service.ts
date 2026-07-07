import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomInt } from 'crypto';
import { Repository } from 'typeorm';
import { EmailOtp } from './email-otp.entity';

const OTP_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class EmailOtpService {
  constructor(
    @InjectRepository(EmailOtp)
    private readonly emailOtpsRepository: Repository<EmailOtp>,
  ) {}

  async issueForUser(userId: string, email: string): Promise<void> {
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Log before DB write so the code is visible even if persistence fails.
    console.log('');
    console.log('==================================================');
    console.log(`[Amana OTP] Email: ${email}`);
    console.log(`[Amana OTP] Code:  ${code}`);
    console.log('[Amana OTP] Expires in 10 minutes');
    console.log('==================================================');
    console.log('');

    await this.emailOtpsRepository.delete({ userId });
    await this.emailOtpsRepository.save({
      userId,
      codeHash: this.hashCode(code),
      expiresAt,
    });
  }

  async verifyForUser(userId: string, code: string): Promise<boolean> {
    const record = await this.emailOtpsRepository.findOne({
      where: { userId },
    });

    if (!record) {
      return false;
    }

    if (record.expiresAt.getTime() < Date.now()) {
      await this.emailOtpsRepository.delete({ userId });
      return false;
    }

    const matches = this.hashCode(code) === record.codeHash;
    if (!matches) {
      return false;
    }

    await this.emailOtpsRepository.delete({ userId });
    return true;
  }

  async hasPendingOtp(userId: string): Promise<boolean> {
    const record = await this.emailOtpsRepository.findOne({
      where: { userId },
    });

    if (!record) {
      return false;
    }

    if (record.expiresAt.getTime() < Date.now()) {
      await this.emailOtpsRepository.delete({ userId });
      return false;
    }

    return true;
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
