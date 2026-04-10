import { BadRequestException, Controller, Get, Post, Body, Query, Req, UseGuards } from '@nestjs/common';
import { RelationshipCustomLabelsService } from './relationship-custom-labels.service';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiBody, ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class UpsertCustomLabelDto {
  @ApiProperty()
  @IsString()
  relationshipKey: string;

  @ApiProperty()
  @IsString()
  language: string;

  @ApiProperty()
  @IsString()
  custom_label: string;

  @ApiProperty()
  @IsNumber()
  creatorId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  familyCode?: string;

  @ApiProperty()
  @IsString()
  scope: string;

   // ADD THESE LINES BELOW
   @ApiProperty({ required: false })
   @IsOptional()
   @IsString()
   gender?: string;
}

@ApiTags('Custom Labels')
@Controller('custom-labels')
export class RelationshipCustomLabelsController {
  constructor(private readonly service: RelationshipCustomLabelsService) {}

  @Get()
  @ApiOperation({ summary: 'Get a custom label' })
  @ApiResponse({ status: 200, description: 'Custom label found' })
  async getCustomLabel(
    @Query('relationshipKey') relationshipKey: string,
    @Query('language') language: string,
    @Query('creatorId') creatorId?: string,
    @Query('familyCode') familyCode?: string,
    @Query('gender') gender?: string,
  ) {
    // Validate and convert creatorId
    if (!relationshipKey || !language || !creatorId || !familyCode) {
      throw new BadRequestException('Missing required query parameters');
    }
    // Optionally convert creatorId to number if needed by service/model
    // const creatorIdNum = Number(creatorId);
    const label = await this.service.getCustomLabel({ relationshipKey, language, creatorId, familyCode, gender });
    return { label };
  }

  @Get('all')
  async getAllLabels(
    @Query('language') language: string,
    @Query('creatorId') creatorId?: string,
    @Query('familyCode') familyCode?: string,
    @Query('gender') gender?: string,
  ) {
    return this.service.getAllLabels({ language, creatorId, familyCode, gender });
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or update a custom label' })
  @ApiResponse({ status: 201, description: 'Custom label upserted' })
  @ApiBody({ type: UpsertCustomLabelDto })
  async upsertCustomLabel(@Req() req, @Body() body: any) {
    if (!body || !body.relationshipKey || !body.language || !body.custom_label || !body.scope) {
      throw new BadRequestException('Missing required fields in request body');
    }
    return this.service.upsertCustomLabel({
      ...body,
      creatorId: Number(req.user?.userId || 0),
    });
  }
}
