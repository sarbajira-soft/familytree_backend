import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
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
 
@Module({
  imports: [
    SequelizeModule.forFeature([
      Family,
      User,
      FamilyMember,
      UserProfile,
      FamilyTree,
      UserRelationship,
    ]),
    NotificationModule,
    UploadModule,
  ],
  controllers: [FamilyController, FamilyMemberController],
  providers: [FamilyService, MailService, FamilyMemberService, RelationshipEdgeService],
  exports: [FamilyService, RelationshipEdgeService],
})
export class FamilyModule {}
