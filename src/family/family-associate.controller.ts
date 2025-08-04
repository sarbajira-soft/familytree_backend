import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { UserProfile } from '../user/model/user-profile.model';

interface AssociateDto {
  sourceCode: string;
  targetCode: string;
}

@ApiTags('Family Module')
@Controller('family')
export class FamilyAssociateController {
  constructor(@InjectModel(UserProfile) private readonly profileModel: typeof UserProfile) {}

  @Post('associate')
  @ApiOperation({ summary: 'Associate two family codes mutually' })
  @ApiResponse({ status: 200, description: 'Association updated' })
  async associateFamilies(@Body() body: AssociateDto) {
    const { sourceCode, targetCode } = body;
    if (!sourceCode || !targetCode || sourceCode === targetCode) {
      throw new BadRequestException('Invalid source/target family codes');
    }

    // helper to merge codes in profile table
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
