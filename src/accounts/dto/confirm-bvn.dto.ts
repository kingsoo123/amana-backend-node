import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ConfirmBvnDto {
  @IsOptional()
  @IsString()
  reference?: string;
}
