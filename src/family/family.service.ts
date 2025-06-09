import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User} from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { MailService } from '../utils/mail.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { CreateFamilyDto } from './dto/create-family.dto';

@Injectable()
export class FamilyService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
    @InjectModel(UserProfile)
    private userProfileModel: typeof UserProfile,
    @InjectModel(Family)
    private familyModel: typeof Family,
    private mailService: MailService,
  ) {}

  async createFamily(dto: CreateFamilyDto, createdBy: number) {
    const existing = await this.familyModel.findOne({ where: { familyCode: dto.familyCode } });
    if (existing) {
      throw new BadRequestException('Family code already exists');
    }
    const created = await this.familyModel.create({
      ...dto,
      createdBy,
    });

    return {
      message: 'Family created successfully',
      data: created,
    };
  }

  async createFamilyMember(dto: CreateFamilyMemberDto, loggedId) {

    const existingEmail = await this.userModel.findOne({ where: { email: dto.email } });
    if (existingEmail) {
      throw new BadRequestException('Email already exists');
    }

    // Check if mobile already exists
    const existingMobile = await this.userModel.findOne({ where: { mobile: dto.mobile } });
    if (existingMobile) {
      throw new BadRequestException('Mobile number already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const newUser = await this.userModel.create({
      email: dto.email,
      password: hashedPassword,
      firstName: dto.firstName,
      createdBy: loggedId,
      lastName: dto.lastName,
      mobile: dto.mobile,
      role: dto.role,
      status: 1
    });
    //delete dto.password;
    await this.userProfileModel.create({
      userId: newUser.id,
      ...dto,
    });
    await this.mailService.sendWelcomeEmail(dto.email, dto.firstName, dto.email, dto.password);

    return {
      id: newUser.id,
      email: newUser.email,
      profile: dto.profile,
    };
  }

   async getAll() {
    return await this.familyModel.findAll();
  }

  async getByCode(code: string) {
    const family = await this.familyModel.findOne({ where: { familyCode: code } });
    if (!family) throw new NotFoundException('Family not found');
    return family;
  }

  async update(id: number, dto: any, newFileName?: string, loggedId?: number) {
    const family = await this.familyModel.findByPk(id);
    if (!family) throw new NotFoundException('Family not found');

    // Delete old file if new file is uploaded
    if (newFileName && family.familyPhoto) {
      const oldFile = family.familyPhoto;
      const uploadDir = process.env.FAMILY_PHOTO_UPLOAD_PATH || './uploads/family';

      if (oldFile && oldFile !== newFileName) {
        const uploadDir = process.env.FAMILY_PHOTO_UPLOAD_PATH || './uploads/family';
        const oldFilePath = path.join(uploadDir, oldFile);

        try {
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
            console.log('Old file deleted:', oldFilePath);
          } else {
            console.warn('Old file does not exist:', oldFilePath);
          }
        } catch (err) {
          console.warn('Failed to delete old file:', err.message);
        }
      }
    }
    dto.createdBy = loggedId;
    await family.update(dto);
    return { message: 'Family updated successfully', data: family };

  }

  async delete(id: number) {
    const family = await this.familyModel.findByPk(id);
    if (!family) throw new NotFoundException('Family not found');

    await family.destroy();
    return { message: 'Family deleted successfully' };
  }

}