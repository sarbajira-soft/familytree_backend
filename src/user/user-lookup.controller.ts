import { Controller, Get, Query, Logger } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiQuery,
  ApiProperty,
} from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from './model/user.model';
import { UserProfile } from './model/user-profile.model';
import {
  buildMobileHash,
  normalizeMobileValue,
} from '../common/security/field-encryption.util';

class PhoneLookupDto {
  @ApiProperty({
    description: 'Phone number to look up (with or without country code)',
    example: '8344102218',
    type: String,
  })
  phone: string;
}

@ApiTags('User Module')
@Controller('user')
export class UserLookupController {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(UserProfile) private readonly profileModel: typeof UserProfile,
  ) {}

  @Public()
  @Get('lookup')
  @ApiOperation({ summary: 'Lookup user by phone' })
  @ApiResponse({ status: 200, description: 'Lookup result' })
  @ApiResponse({ status: 400, description: 'Invalid phone number format' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiQuery({ name: 'phone', type: String, required: true, description: 'Phone number to look up (with or without country code)' })
  async lookup(@Query('phone') phone: string) {
    Logger.log('Phone lookup request received', UserLookupController.name);

    try {
      if (!phone || typeof phone !== 'string') {
        return { exists: false, message: 'A valid phone number is required' };
      }

      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        return { exists: false, message: 'Phone number must be at least 10 digits' };
      }

      const last10Digits = cleanPhone.slice(-10);
      const normalizedMobile = normalizeMobileValue(last10Digits);
      const mobileHash = buildMobileHash(normalizedMobile);

      const user = await this.userModel.findOne({
        where: {
          status: 1,
          [Op.or]: [
            { mobileHash },
            { mobile: normalizedMobile },
          ],
        },
        include: [{
          model: UserProfile,
          as: 'userProfile',
          required: false,
        }],
      });

      if (!user) {
        return {
          exists: false,
          message: 'User not found with the provided phone number',
        };
      }

      const userData = user.get({ plain: true });
      return {
        exists: true,
        user: {
          id: userData.id,
          firstName: userData.userProfile?.firstName || null,
          lastName: userData.userProfile?.lastName || null,
          fullName: [userData.userProfile?.firstName, userData.userProfile?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || null,
          familyCode: userData.userProfile?.familyCode || null,
          profilePicture: userData.userProfile?.profile || null,
          gender: userData.userProfile?.gender || null,
          isAppUser: Boolean(userData.isAppUser),
        },
      };
    } catch (error) {
      Logger.error(`Error in user lookup: ${error.message}`, error.stack, UserLookupController.name);
      return { exists: false, message: 'Error processing your request. Please try again later.' };
    }
  }
}
