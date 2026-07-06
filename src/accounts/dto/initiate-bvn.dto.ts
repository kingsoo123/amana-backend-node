import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class InitiateBvnDto {
  @IsString()
  @IsNotEmpty()
  @Length(11, 11)
  @Matches(/^\d{11}$/, { message: 'BVN must be 11 digits' })
  bvn: string;
}
