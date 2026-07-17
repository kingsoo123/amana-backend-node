import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateRiderPresenceDto {
  @IsBoolean()
  isOnline: boolean;

  /** Required when going online — browser GPS often has >7 decimal places. */
  @ValidateIf((dto: UpdateRiderPresenceDto) => dto.isOnline === true)
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ValidateIf((dto: UpdateRiderPresenceDto) => dto.isOnline === true)
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
