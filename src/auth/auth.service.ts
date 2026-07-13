import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { UsersService } from '../users/users.service';
import { EmailOtpService } from './email-otp.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
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
    private readonly emailOtpService: EmailOtpService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      const alreadyVerified = await this.usersService.isEmailVerified(
        existingUser.id,
      );

      if (!alreadyVerified) {
        await this.emailOtpService.issueForUser(existingUser.id, email);
        return {
          message:
            'Account exists but is not verified yet. A new verification code was issued.',
          email,
          requiresVerification: true,
        };
      }

      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.usersService.create({
      firstname: dto.firstname.trim(),
      lastname: dto.lastname.trim(),
      email,
      phoneNumber: dto.phoneNumber,
      passwordHash,
    });

    await this.emailOtpService.issueForUser(user.id, email);

    return {
      message: 'Account created. Enter the verification code to continue.',
      email,
      requiresVerification: true,
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('Invalid verification code');
    }

    if (await this.usersService.isEmailVerified(user.id)) {
      return {
        message: 'Email already verified. You can sign in.',
        email,
      };
    }

    const valid = await this.emailOtpService.verifyForUser(user.id, dto.code);
    if (!valid) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.usersService.setEmailVerified(user.id, true);

    return {
      message: 'Email verified successfully. You can now sign in.',
      email,
    };
  }

  async resendOtp(dto: ResendOtpDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('No account found for this email');
    }

    if (await this.usersService.isEmailVerified(user.id)) {
      return {
        message: 'Email already verified. You can sign in.',
        email,
      };
    }

    await this.emailOtpService.issueForUser(user.id, email);

    return {
      message: 'A new verification code was issued.',
      email,
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

    if (!(await this.usersService.isEmailVerified(user.id))) {
      const hasPendingOtp = await this.emailOtpService.hasPendingOtp(user.id);
      if (hasPendingOtp) {
        await this.emailOtpService.issueForUser(user.id, email);
        throw new UnauthorizedException(
          'Please verify your email before signing in',
        );
      }

      await this.usersService.setEmailVerified(user.id, true);
    }

    const jti = randomUUID();
    const token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      jti,
    });

    return {
      token,
      data: {
        id: user.id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        role: user.role,
      },
    };
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
