import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MinioModule } from '../../minio/minio.module';
import { Guide } from '../auth/entities/guide.entity';
import { GuideEmail } from '../auth/entities/guide-email.entity';
import { AuthModule } from '../auth/auth.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ContractExpirationService } from './contract-expiration.service';

@Module({
  imports: [TypeOrmModule.forFeature([Guide, GuideEmail]), MinioModule, AuthModule],
  controllers: [ComplianceController],
  providers: [ComplianceService, ContractExpirationService],
})
export class ComplianceModule {}
