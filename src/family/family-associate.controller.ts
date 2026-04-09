import { Body, Controller, Post, BadRequestException, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { UserProfile } from '../user/model/user-profile.model';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FamilyService } from './family.service';

interface AssociateDto {
  sourceCode: string;
  targetCode: string;
}

@ApiTags('Family Module')
@Controller('family')
export class FamilyAssociateController {
  constructor(
    @InjectModel(UserProfile) private readonly profileModel: typeof UserProfile,
    private readonly familyService: FamilyService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('associate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Associate two family codes mutually' })
  @ApiResponse({ status: 200, description: 'Association updated' })
  async associateFamilies(@Req() req, @Body() body: AssociateDto) {
    const sourceCode = String(body?.sourceCode || '').trim().toUpperCase();
    const targetCode = String(body?.targetCode || '').trim().toUpperCase();
    const actingUserId = Number(req.user?.userId || 0);

    if (!sourceCode || !targetCode || sourceCode === targetCode) {
      throw new BadRequestException('Invalid source/target family codes');
    }

    await this.familyService.assertFamilyAdminAccess(
      actingUserId,
      sourceCode,
      'associate this source family',
    );
    await this.familyService.assertFamilyAdminAccess(
      actingUserId,
      targetCode,
      'associate this target family',
    );

    const mergeCodes = async (familyCode: string, codeToAdd: string) => {
      const profiles = await this.profileModel.findAll({ where: { familyCode } });
      for (const profile of profiles) {
        const list: string[] = Array.isArray(profile.associatedFamilyCodes)
          ? profile.associatedFamilyCodes
          : [];
        if (!list.includes(codeToAdd)) {
          list.push(codeToAdd);
          await profile.update({ associatedFamilyCodes: list });
        }
      }
    };

    await mergeCodes(sourceCode, targetCode);
    await mergeCodes(targetCode, sourceCode);

    return {
      message: 'Families associated successfully',
      sourceCode,
      targetCode,
    };
  }
}
