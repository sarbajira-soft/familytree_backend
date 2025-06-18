import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FamilyService } from './family.service';
import { BulkInsertFamilyPositionsDto } from './dto/family-position.dto';

@ApiTags('Family Position Module')
@Controller('family-position')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FamilyPositionController {
  constructor(private readonly familyService: FamilyService) {}

  @Post('familyPositionCreate')
  async bulkInsertPositions(@Body() dto: BulkInsertFamilyPositionsDto) {
    return this.familyService.bulkInsertPositions(dto);
  }

  @Get('getFamilyPosition/:familyCode')
  async getByFamilyCode(@Param('familyCode') familyCode: string) {
    return this.familyService.getFamilyHierarchyByCode(familyCode);
  }
  
}
