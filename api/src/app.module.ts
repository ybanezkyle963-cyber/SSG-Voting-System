import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { ElectionController } from './election.controller';

@Module({
  controllers: [ElectionController],
  providers: [DatabaseService]
})
export class AppModule {}
