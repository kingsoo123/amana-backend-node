import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmTransactionDto {
  @IsEmail()
  confirmedBy: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
