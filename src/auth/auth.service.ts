import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RevokedTokensService } from './revoked-tokens.service';

type JwtPayload = {
  sub: string;
  email: string;
  jti?: string;
  exp?: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly revokedTokensService: RevokedTokensService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.usersService.create({
      firstname: dto.firstname.trim(),
      lastname: dto.lastname.trim(),
      email,
      phoneNumber: dto.phoneNumber,
      passwordHash,
    });

    return {
      message: 'Account created successfully',
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmailWithPassword(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const jti = randomUUID();
    const token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      jti,
    });

    return { token };
  }

  async logout(token?: string) {
    if (token) {
      await this.revokeToken(token);
    }

    return { message: 'Logged out successfully' };
  }

  private async revokeToken(token: string) {
    let payload: JwtPayload | null = null;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      payload = this.jwtService.decode(token) as JwtPayload | null;
    }

    if (!payload?.jti) {
      return;
    }

    const expiresAt =
      typeof payload.exp === 'number'
        ? new Date(payload.exp * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.revokedTokensService.revoke(payload.jti, expiresAt);
  }
}
