import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { RidersController } from './riders.controller';
import { RidersService } from './riders.service';
import { User } from './user.entity';
import { UsersModule } from './users.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Invoice]), UsersModule],
  controllers: [RidersController],
  providers: [RidersService],
  exports: [RidersService],
})
export class RidersModule {}
