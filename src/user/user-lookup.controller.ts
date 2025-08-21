import { Controller, Get, Query, Logger } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { 
  ApiOperation, 
  ApiResponse, 
  ApiTags, 
  ApiQuery, 
  ApiProperty 
} from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { User } from './model/user.model';
import { UserProfile } from './model/user-profile.model';
// Note: Avoid strict class-validator here to keep this endpoint error-less for UX

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
    Logger.log(`Lookup request for phone=${phone}`);
    
    try {
      // Basic validation - check if phone is provided. Never throw 400 – return exists:false
      if (!phone || typeof phone !== 'string') {
        return { exists: false, message: 'A valid phone number is required' };
      }
      
      // Remove any non-digit characters and convert to string
      const cleanPhone = phone.replace(/\D/g, '');
      
      // Check if we have at least 10 digits
      if (cleanPhone.length < 10) {
        return { exists: false, message: 'Phone number must be at least 10 digits' };
      }
      
      // Extract the last 10 digits (in case country code is included)
      const last10Digits = cleanPhone.slice(-10);
      
      // Log the values for debugging
      Logger.debug(`Phone lookup - Original: ${phone}, Cleaned: ${cleanPhone}, Last 10: ${last10Digits}`);
      
      // Find user with the last 10 digits
      const user = await this.userModel.findOne({ 
        where: { 
          mobile: last10Digits,
          status: 1 // Only active users
        },
        include: [{
          model: UserProfile,
          as: 'userProfile',
          required: false
        }]
      });
      
      if (!user) {
        return { 
          exists: false,
          message: 'User not found with the provided phone number',
          ...(process.env.NODE_ENV === 'development' ? {
            debug: {
              input: phone,
              cleaned: cleanPhone,
              usedDigits: last10Digits,
              length: cleanPhone.length
            }
          } : {})
        };
      }
      
      // Get user data as plain object
      const userData = user.get({ plain: true });
      
      // Format the response
      return {
        exists: true,
        user: {
          id: userData.id,
          email: userData.email || null,
          mobile: userData.mobile || null,
          countryCode: userData.countryCode || null,
          firstName: userData.userProfile?.firstName || null,
          lastName: userData.userProfile?.lastName || null,
          fullName: [userData.userProfile?.firstName, userData.userProfile?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || null,
          familyCode: userData.userProfile?.familyCode || null,
          profilePicture: userData.userProfile?.profile || null,
          gender: userData.userProfile?.gender || null
        }
      };
      
    } catch (error) {
      Logger.error(`Error in user lookup: ${error.message}`, error.stack);
      // Never surface 500/400 to client for this lookup; keep it error-less
      return { exists: false, message: 'Error processing your request. Please try again later.' };
    }
  }
}
