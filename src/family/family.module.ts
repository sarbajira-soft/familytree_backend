import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { FamilyMemberController } from './family-member.controller';
import { FamilyMemberService } from './family-member.service';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { FamilyTree } from './model/family-tree.model';
import { UserRelationship } from './model/user-relationship.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { MailService } from '../utils/mail.service';
import { NotificationModule } from '../notification/notification.module';
import { RelationshipEdgeService } from './relationship-edge.service';
import { UploadModule } from '../uploads/upload.module';
import { NotificationService } from '../notification/notification.service';
import { RelationshipPathService } from './relationship-path.service';
import { UserModule } from '../user/user.module';
import { FamilyMergeRequest } from './model/family-merge-request.model';
import { FamilyMergeState } from './model/family-merge-state.model';
import { FamilyMergeService } from './family-merge.service';
import { FamilyMergeController } from './family-merge.controller';


@Module({
  imports: [
    SequelizeModule.forFeature([
      Family,
      User,
      FamilyMember,
      UserProfile,
      FamilyTree,
      UserRelationship,
      FamilyMergeRequest,
      FamilyMergeState,
    ]),
    forwardRef(() => NotificationModule),
    forwardRef(() => UserModule),
    UploadModule,
  ],
  controllers: [FamilyController, FamilyMemberController, FamilyMergeController],
  providers: [
    RelationshipPathService,
    FamilyService,
    FamilyMergeService,
    MailService,
    FamilyMemberService,
    RelationshipEdgeService,
    {
      provide: 'SEQUELIZE',
      useExisting: Sequelize,
    },
  ],
  exports: [
    FamilyService,
    RelationshipEdgeService,
    FamilyMemberService,
    SequelizeModule,
  ],
})
export class FamilyModule {}
