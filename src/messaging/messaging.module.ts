import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module';
import { MessagingController } from './messaging.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { User } from '../sabeel/auth/entities/user.entity';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';
import { Guide } from '../sabeel-guide/auth/entities/guide.entity';
import { AgencyGroup } from '../admin_agence/group/entities/group.entity';
import { AgencyGuide } from '../admin_agence/guide/entities/guide.entity';
import { FreelanceGroup } from '../sabeel-guide/freelance-groups/entities/freelance-group.entity';
import { FreelanceGroupMember } from '../sabeel-guide/freelance-groups/entities/freelance-group-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Message,
      User,
      AdminAgenceUser,
      Guide,
      AgencyGroup,
      AgencyGuide,
      FreelanceGroup,
      FreelanceGroupMember,
    ]),
    CommonModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService, MessagingGateway],
  exports: [MessagingService, MessagingGateway, TypeOrmModule],
})
export class MessagingModule {}
