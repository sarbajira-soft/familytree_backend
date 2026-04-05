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
import { TreeProjectionService } from './tree-projection.service';
import { UserModule } from '../user/user.module';
import { BlockingModule } from '../blocking/blocking.module';
import { Gallery } from '../gallery/model/gallery.model';
import { Post } from '../post/model/post.model';
import { Event } from '../event/model/event.model';


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
      Gallery,
      Post,
      Event,
    ]),
    forwardRef(() => NotificationModule),
    forwardRef(() => UserModule),
    BlockingModule,
    UploadModule,
  ],
  controllers: [FamilyController, FamilyMemberController],
  providers: [
    RelationshipPathService,
    TreeProjectionService,
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
    TreeProjectionService,
    SequelizeModule,
  ],
})
export class FamilyModule {}

