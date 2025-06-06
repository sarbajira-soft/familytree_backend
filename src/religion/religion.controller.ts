import { Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
  UseGuards } from '@nestjs/common';
import { ReligionService } from './religion.service';
import { CreateReligionDto } from './dto/create-religion.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Religion')
@Controller('religion')
export class ReligionController {
  constructor(private readonly religionService: ReligionService) {}

  @Get()
  @ApiOperation({ summary: 'Get all religions' })
  list() {
    return this.religionService.listReligions();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Post()
  @ApiOperation({ summary: 'Create a new religion' })
  @ApiResponse({ status: 201, description: 'Religion created successfully' })
  create(@Body() dto: CreateReligionDto) {
    return this.religionService.createReligion(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Get(':id')
  @ApiOperation({ summary: 'Get a religion by ID' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.religionService.getReligion(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a religion' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateReligionDto) {
    return this.religionService.updateReligion(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a religion' })
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.religionService.deleteReligion(id);
  }
}
