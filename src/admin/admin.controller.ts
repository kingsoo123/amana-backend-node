import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminResolveDisputeDto } from '../disputes/dto/admin-resolve-dispute.dto';
import { User } from '../users/user.entity';
import { AdminService } from './admin.service';

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  getOverview() {
    return this.adminService.getOverview();
  }

  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
  }

  @Patch('users/:id/role')
  updateUserRole(
    @Param('id') id: string,
    @Body() body: { role: User['role'] },
  ) {
    return this.adminService.updateUserRole(id, body.role);
  }

  @Get('invoices')
  listInvoices() {
    return this.adminService.listInvoices();
  }

  @Get('disputes')
  listDisputes(@Query('status') status?: string) {
    return this.adminService.listDisputes(status);
  }

  @Patch('disputes/:id')
  resolveDispute(
    @CurrentUser() admin: User,
    @Param('id') id: string,
    @Body() dto: AdminResolveDisputeDto,
  ) {
    return this.adminService.resolveDispute(admin, id, dto);
  }
}
