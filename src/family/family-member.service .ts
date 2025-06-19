import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User} from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { MailService } from '../utils/mail.service';
import { extractUserProfileFields } from '../utils/profile-mapper.util';
import { getLevelDepth, isSpousePosition } from '../utils/level-position.util';
import { hash, bcrypt } from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

import { CreateFamilyMemberDto } from './dto/create-family-member.dto';

@Injectable()
export class FamilyMemberService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
    @InjectModel(UserProfile)
    private userProfileModel: typeof UserProfile,
    @InjectModel(Family)
    private familyModel: typeof Family,
    @InjectModel(FamilyMember)
    private familyMemberModel: typeof FamilyMember,
    private mailService: MailService,
  ) {}

  async createFamilyMember(dto: CreateFamilyMemberDto, createdBy: number) {
    try{
      // Check email duplication
       const existingVerifiedUser = await this.userModel.findOne({
        where: {
          status: 1,
          [Op.or]: [
            { email: dto.email },
            {
              countryCode: dto.countryCode,
              mobile: dto.mobile,
            },
          ],
        },
      });

      if (existingVerifiedUser) {
        throw new BadRequestException('User with this email or mobile already exists');
      }

      // Optional: Validate familyCode
      if (dto.familyCode) {
        const family = await this.familyModel.findOne({ where: { familyCode: dto.familyCode } });
        if (!family) throw new BadRequestException('Invalid family code');
      }

      const user = await this.userModel.create({
        email: dto.email,
        countryCode: dto.countryCode,
        mobile: dto.mobile,
        password: await hash(dto.password, 10),
        role: 1,
        status: 1,
        createdBy,
      });

      const profileFields = extractUserProfileFields(dto);

      const userProfile = await this.userProfileModel.create({
        userId: user.id,
        ...profileFields,
      });

      await this.familyMemberModel.create({
        memberId: user.id,       
        familyCode: dto.familyCode,
        creatorId: createdBy,
        approveStatus: 'approved'
      });

      return {
        message: 'Family member created successfully',
        data: { user, userProfile },
      };
    }catch(error){
      return{
        message: error,
        data:[]
      }
    }
  }

  async updateFamilyMember(userId: number, dto: CreateFamilyMemberDto) {
    const user = await this.userModel.findByPk(userId);
    if (!user || user.role !== 1) throw new BadRequestException('Family member not found');

    const profile = await this.userProfileModel.findOne({ where: { userId } });
    if (!profile) throw new BadRequestException('Profile not found');

    if (dto.email && dto.email !== user.email) {
      const exists = await this.userModel.findOne({ where: { email: dto.email } });
      if (exists) throw new BadRequestException('Email already in use');
      user.email = dto.email;
    }

    if (dto.mobile) user.mobile = dto.mobile;
    if (dto.password) user.password = await hash(dto.password, 10);

    await user.save();

    // Handle profile image overwrite
    if (dto.profile) {
      const newFile = path.basename(dto.profile);
      const oldFile = profile.profile;
      if (oldFile && oldFile !== newFile) {
        const filePath = path.join(process.env.PROFILE_UPLOAD_PATH || './uploads/profile', oldFile);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }

    profile.set(dto as any);
    await profile.save();

    return {
      message: 'Family member updated successfully',
      data: { user, profile },
    };
  }

  async deleteFamilyMember(userId: number) {
    const user = await this.userModel.findByPk(userId);
    if (!user || user.role !== 1) throw new BadRequestException('Family member not found');

    const profile = await this.userProfileModel.findOne({ where: { userId } });

    // Delete profile image if exists
    if (profile?.profile) {
      const filePath = path.join(process.env.UPLOAD_FOLDER_PATH || './uploads/profile', profile.profile);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await this.userProfileModel.destroy({ where: { userId } });
    await this.userModel.destroy({ where: { id: userId } });

    return { message: 'Family member deleted successfully' };
  }

  async getMemberById(userId: number) {
    const user = await this.userModel.findOne({
      where: { id: userId, role: 1 },
      include: [{ model: this.userProfileModel }],
    });
    if (!user) throw new NotFoundException('Family member not found');
    return user;
  }

  async getAllFamilyMembers(familyCode: string) {
    const members = await this.userProfileModel.findAll({
      where: { familyCode },
      include: [
        {
          model: this.userModel,
          attributes: ['id', 'email', 'mobile', 'role', 'status'],
        },
      ],
      order: [['firstName', 'ASC']],
    });

    return {
      message: `${members.length} members found in family`,
      data: members,
    };
  }

}