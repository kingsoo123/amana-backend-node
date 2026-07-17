import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NearbyRidersQueryDto } from './dto/nearby-riders-query.dto';
import { SaveProfilePhotoDto } from './dto/save-profile-photo.dto';
import { SignProfilePhotoUploadDto } from './dto/sign-profile-photo-upload.dto';
import { UpdateRiderEngagementDto } from './dto/update-rider-engagement.dto';
import { UpdateRiderPresenceDto } from './dto/update-rider-presence.dto';
import { User } from './user.entity';
import { RidersService } from './riders.service';
import { UsersService } from './users.service';

@Controller('api/v1/riders')
@UseGuards(JwtAuthGuard)
export class RidersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly ridersService: RidersService,
  ) {}

  @Get('nearby')
  listNearby(@Query() query: NearbyRidersQueryDto) {
    return this.ridersService.listNearbyAvailable(query);
  }

  @Post('me/profile-photo/uploads/sign')
  signProfilePhotoUpload(
    @CurrentUser() user: User,
    @Body() dto: SignProfilePhotoUploadDto,
  ) {
    this.assertRider(user);
    return this.usersService.signProfilePhotoUpload(user, dto);
  }

  @Patch('me/profile-photo')
  saveProfilePhoto(
    @CurrentUser() user: User,
    @Body() dto: SaveProfilePhotoDto,
  ) {
    this.assertRider(user);
    return this.usersService.saveProfilePhoto(user, dto);
  }

  @Patch('me/presence')
  updatePresence(
    @CurrentUser() user: User,
    @Body() dto: UpdateRiderPresenceDto,
  ) {
    return this.ridersService.updatePresence(user, dto);
  }

  @Patch('me/engagement')
  updateEngagement(
    @CurrentUser() user: User,
    @Body() dto: UpdateRiderEngagementDto,
  ) {
    return this.ridersService.updateEngagement(user, dto);
  }

  @Get('me/tracking')
  getTracking(@CurrentUser() user: User) {
    this.assertRider(user);
    return this.ridersService.getEngagedTracking(user);
  }

  private assertRider(user: User) {
    if (user.role !== 'rider') {
      throw new ForbiddenException('Only rider accounts can manage rider profile');
    }
  }
}
