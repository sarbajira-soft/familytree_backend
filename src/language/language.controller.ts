import { Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
  UseGuards, } from '@nestjs/common';
import { LanguageService } from './language.service';
import { UpdateLanguageDto } from './dto/update-language.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Language')
@Controller('language')
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  @Get()
  @ApiOperation({ summary: 'Get all languages' })
  list() {
    return this.languageService.listLanguages();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Post()
  @ApiOperation({ summary: 'Create a new language' })
  @ApiResponse({ status: 201, description: 'Language created successfully' })
  create(@Body() dto: UpdateLanguageDto) {
    return this.languageService.createLanguage(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Get(':id')
  @ApiOperation({ summary: 'Get a language by ID' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.languageService.getLanguage(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a language' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLanguageDto) {
    return this.languageService.updateLanguage(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a language' })
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.languageService.deleteLanguage(id);
  }

}
