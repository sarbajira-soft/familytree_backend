import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { GothramService } from './gothram.service';
import { UpdateGothramDto } from './dto/update-gothram.dto';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Gothram')
@ApiBearerAuth()
@Controller('gothram')
export class GothramController {
  constructor(private readonly gothramService: GothramService) {}

  @Get()
  @ApiOperation({ summary: 'Get all gothrams' })
  list() {
    return this.gothramService.listGothrams();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Post()
  @ApiOperation({ summary: 'Create a new gothram' })
  @ApiResponse({ status: 201, description: 'Gothram created successfully' })
  create(@Body() dto: UpdateGothramDto) {
    return this.gothramService.createGothram(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Get(':id')
  @ApiOperation({ summary: 'Get a gothram by ID' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.gothramService.getGothram(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a gothram' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGothramDto,
  ) {
    return this.gothramService.updateGothram(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a gothram' })
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.gothramService.deleteGothram(id);
  }
}
