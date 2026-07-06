import {
  Controller,
  Get,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('user')
  @UseGuards(JwtAuthGuard)
  async getUser(
    @Query('request') request: string,
    @CurrentUser() currentUser: User,
  ) {
    const email = request?.trim().toLowerCase();

    if (!email) {
      throw new UnauthorizedException('User email is required');
    }

    if (currentUser.email !== email) {
      throw new UnauthorizedException('You can only access your own profile');
    }

    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const verified = await this.usersService.isVerified(user.id);

    return {
      data: {
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        verified,
        role: user.role,
      },
    };
  }
}
