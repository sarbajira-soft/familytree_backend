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
import { FamilyLink } from './model/family-link.model';
import { TreeLink } from './model/tree-link.model';
import { UserRelationship } from './model/user-relationship.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { MailService } from '../utils/mail.service';
import { NotificationModule } from '../notification/notification.module';
import { RelationshipEdgeService } from './relationship-edge.service';
import { UploadModule } from '../uploads/upload.module';
import { RelationshipPathService } from './relationship-path.service';
import { UserModule } from '../user/user.module';


@Module({
  imports: [
    SequelizeModule.forFeature([
      Family,
      User,
      FamilyMember,
      UserProfile,
      FamilyTree,
      FamilyLink,
      TreeLink,
      UserRelationship,
    ]),
    forwardRef(() => NotificationModule),
    forwardRef(() => UserModule),
    UploadModule,
  ],
  controllers: [FamilyController, FamilyMemberController],
  providers: [
    RelationshipPathService,
    FamilyService,
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
