import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const RIDER_VEHICLE_TYPES = ['bike', 'car', 'truck', 'van'] as const;
export type RegisterVehicleType = (typeof RIDER_VEHICLE_TYPES)[number];

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  firstname: string;

  @IsString()
  @IsNotEmpty()
  lastname: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @MinLength(8)
  password: string;

  /** Register as a dispatch rider when set to `rider`. */
  @IsOptional()
  @IsIn(['user', 'rider'])
  accountType?: 'user' | 'rider';

  /** Required when accountType is `rider` — pick one or more vehicles. */
  @ValidateIf((dto: RegisterDto) => dto.accountType === 'rider')
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(RIDER_VEHICLE_TYPES, { each: true })
  vehicleTypes?: RegisterVehicleType[];
}
