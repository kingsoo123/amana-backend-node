import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit code' })
  code: string;
}
