import { Controller, Get, Query, Logger } from '@nestjs/common';
import { Public } from '../auth/public.decorator';


import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { User } from './model/user.model';
import { UserProfile } from './model/user-profile.model';





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
  async lookup(@Query('phone') phone: string) {
    Logger.log(`Lookup request for phone=${phone}`);
    

    const user = await this.userModel.findOne({ where: { mobile: phone } });
    if (!user) {
      return { exists: false };
    }

    const profile = await this.profileModel.findOne({ where: { userId: user.id } });
    return {
      exists: true,
      user: {
        id: user.id,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        familyCode: profile?.familyCode ?? null,
      },
    };
  }
}
