import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { DashboardService } from './dashboard.service';

@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('seller')
  @UseGuards(JwtAuthGuard)
  getSellerDashboard(@CurrentUser() user: User) {
    return this.dashboardService.getSellerDashboard(user.id);
  }
}
