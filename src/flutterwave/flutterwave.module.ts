import { Module } from '@nestjs/common';
import { FlutterwaveService } from './flutterwave.service';
import { FlutterwaveTransfersService } from './flutterwave-transfers.service';

@Module({
  providers: [FlutterwaveService, FlutterwaveTransfersService],
  exports: [FlutterwaveService, FlutterwaveTransfersService],
})
export class FlutterwaveModule {}
