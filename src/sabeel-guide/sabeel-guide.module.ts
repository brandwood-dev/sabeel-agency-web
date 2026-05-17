import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { GroupsModule } from './groups/groups.module';
import { FreelanceGroupsModule } from './freelance-groups/freelance-groups.module';
import { ComplianceModule } from './compliance/compliance.module';

@Module({
  imports: [AuthModule, GroupsModule, FreelanceGroupsModule, ComplianceModule],
  exports: [AuthModule, GroupsModule, FreelanceGroupsModule, ComplianceModule],
})
export class SabeelGuideModule {}
