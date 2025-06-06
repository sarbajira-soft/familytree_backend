import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserController } from './user.controller';
import { UserService } from './user.service';

import { User } from './model/user.model';
import { UserProfile } from './model/user-profile.model';
import { MailService } from '../utils/mail.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      User,
      UserProfile,
    ]),
  ],
  controllers: [UserController],
  providers: [UserService, MailService],
  exports: [UserService],
})
export class UserModule {}
