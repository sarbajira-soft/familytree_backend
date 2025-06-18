import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FamilyService } from './family.service';
import { CreateRelationshipTranslationDto } from './dto/create-relationship-translation.dto';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';

@ApiTags('Relationship Translations')
@Controller('ft-relationship-translations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FtRelationshipTranslationController {
  constructor(private readonly service: FamilyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new relationship translation' })
  @ApiResponse({ status: 201, description: 'Translation created successfully' })
  create(@Body() dto: CreateRelationshipTranslationDto) {
    return this.service.addRelationshipTranslation(dto);
  }

  @Get('lang/:languageCode')
  @ApiOperation({ summary: 'Get translations by language code' })
  @ApiParam({ name: 'languageCode', type: 'string', example: 'ta' })
  findByLang(@Param('languageCode') lang: string) {
    return this.service.listRelationshipTranslations(lang);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a relationship translation by ID' })
  @ApiParam({ name: 'id', type: 'integer' })
  update(
    @Param('id') id: number,
    @Body() dto: Partial<CreateRelationshipTranslationDto>,
  ) {
    return this.service.updateRelationshipTranslation(id, dto as any);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a relationship translation by ID' })
  @ApiParam({ name: 'id', type: 'integer' })
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: number) {
    return this.service.deleteRelationshipTranslation(id);
  }
}
