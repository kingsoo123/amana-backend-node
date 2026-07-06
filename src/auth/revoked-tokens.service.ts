import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RevokedToken } from './revoked-token.entity';

@Injectable()
export class RevokedTokensService {
  constructor(
    @InjectRepository(RevokedToken)
    private readonly revokedTokensRepository: Repository<RevokedToken>,
  ) {}

  async revoke(jti: string, expiresAt: Date): Promise<void> {
    await this.revokedTokensRepository.save({ jti, expiresAt });
  }

  async isRevoked(jti: string): Promise<boolean> {
    const revoked = await this.revokedTokensRepository.findOne({
      where: { jti },
    });
    return Boolean(revoked);
  }

  async purgeExpired(): Promise<void> {
    await this.revokedTokensRepository.delete({
      expiresAt: LessThan(new Date()),
    });
  }
}
