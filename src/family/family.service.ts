import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User} from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FtFamilyPosition } from './model/family-position.model';
import { FtRelationshipTranslation } from './model/relationship-translations.model';
import { MailService } from '../utils/mail.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

import { CreateRelationshipTranslationDto } from './dto/create-relationship-translation.dto';
import { CreateFamilyDto } from './dto/create-family.dto';
import { BulkInsertFamilyPositionsDto } from './dto/family-position.dto';


@Injectable()
export class FamilyService {
  constructor(
    @InjectModel(FtFamilyPosition)
    private ftFamilyPositionRepo: typeof FtFamilyPosition,
    @InjectModel(FtRelationshipTranslation)
    private relationshipTranslationRepo: typeof FtRelationshipTranslation,
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

  async getFamilyRelationshipMap(viewerId: number, familyId: number, language: string = 'en') {
    // const viewerPosition = await this.ftFamilyPositionRepo.findOne({
    //   where: { userId: viewerId, familyId }
    // });

    // if (!viewerPosition) throw new NotFoundException('Viewer position not found');

    // const allMembers = await this.ftFamilyPositionRepo.findAll({
    //   where: { familyId },
    //   include: [
    //     {
    //       model: User,
    //       include: [
    //         {
    //           model: UserProfile,
    //           as: 'userProfile',
    //         }
    //       ]
    //     }
    //   ]
    // });

    // // Caching all relationships for the language
    // const fromLevels = allMembers.map(m => viewerPosition.positionLevel);
    // const toLevels = allMembers.map(m => m.positionLevel);

    // const relationshipTranslations = await this.relationshipTranslationRepo.findAll({
    //   where: {
    //     languageCode: language,
    //     fromLevel: viewerPosition.positionLevel,
    //     toLevel: toLevels,
    //   }
    // });

    // // Create cache key: `${fromLevel}-${toLevel}-${gender}`
    // const translationCache = new Map<string, string>();
    // for (const rel of relationshipTranslations) {
    //   const key = `${rel.fromLevel}-${rel.toLevel}-${rel.gender}`;
    //   translationCache.set(key, rel.relationshipName);
    // }

    // // Build final result using cache
    // const result = allMembers.map((member) => {
    //   const profile = member.user?.userProfile;
    //   const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
    //   const gender = profile?.gender;

    //   const isViewer = member.userId === viewerId;

    //   const cacheKey = `${viewerPosition.positionLevel}-${member.positionLevel}-${gender}`;
    //   const relationshipName = translationCache.get(cacheKey) || (isViewer ? 'Me' : 'Unknown');

    //   return {
    //     userId: member.userId,
    //     name: fullName,
    //     position: member.positionLevel,
    //     gender,
    //     relationship: relationshipName,
    //   };
    // });

    // return result;
  }

  async bulkInsertPositions(dto: BulkInsertFamilyPositionsDto) {
    if (!dto.positions || dto.positions.length === 0) {
      throw new BadRequestException('No position data provided');
    }

    const familyCode = dto.positions[0].familyCode;

    // 1. Validate family
    const family = await this.familyModel.findOne({ where: { familyCode} });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    // 2. Delete existing positions
    await this.ftFamilyPositionRepo.destroy({ where: { familyCode } });

    // 3. Bulk insert new positions
    const created = await this.ftFamilyPositionRepo.bulkCreate(dto.positions as any);

    return {
      message: 'Family positions updated successfully',
      count: created.length,
    };
  }

  async getFamilyHierarchyByCode(familyCode: string) {
    const family = await this.familyModel.findOne({ where: { familyCode } });

    if (!family) throw new NotFoundException('Family not found');

    const positions = await this.ftFamilyPositionRepo.findAll({
      where: { familyCode: family.familyCode },
      include: [
        {
          model: this.userModel,
          as: 'user',
          attributes: ['id', 'email', 'mobile', 'role'],
        },
        {
          model: this.userProfileModel,
          as: 'familyUser',
          attributes: ['firstName', 'lastName', 'dob', 'gender', 'profile'],
        },
      ],
      order: [['position', 'ASC']], 
    });

    return {
      message: 'Family position hierarchy fetched',
      data: positions,
    };
  }

  async addRelationshipTranslation(dto: CreateRelationshipTranslationDto) {
    const exists = await this.relationshipTranslationRepo.findOne({
      where: {
        languageCode: dto.languageCode,
        fromLevel: dto.fromLevel,
        toLevel: dto.toLevel,
        fromGender: dto.fromGender,
        toGender: dto.toGender
      }
    });
    if (exists) throw new BadRequestException('Translation already exists');

    return await this.relationshipTranslationRepo.create(dto as Partial<FtRelationshipTranslation>);
  }

  async updateRelationshipTranslation(id: number, dto: CreateRelationshipTranslationDto) {
    const rel = await this.relationshipTranslationRepo.findByPk(id);
    if (!rel) throw new NotFoundException('Relationship translation not found');

    await rel.update(dto);
    return { message: 'Updated successfully', data: rel };
  }

  async deleteRelationshipTranslation(id: number) {
    const rel = await this.relationshipTranslationRepo.findByPk(id);
    if (!rel) throw new NotFoundException('Relationship translation not found');

    await rel.destroy();
    return { message: 'Deleted successfully' };
  }

  async listRelationshipTranslations(languageCode?: string) {
    return await this.relationshipTranslationRepo.findAll({
      where: languageCode ? { languageCode } : undefined,
      order: [['fromLevel', 'ASC'], ['toLevel', 'ASC']]
    });
  }

  

}