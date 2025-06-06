import { Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
  UseGuards } from '@nestjs/common';
import { CountryService } from './country.service';
import { UpdateCountryDto } from './dto/update-country.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Country')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  @ApiOperation({ summary: 'Get all countries' })
  list() {
    return this.countryService.listCountries();
  }

  @Post()
  @ApiOperation({ summary: 'Create a new country' })
  @ApiResponse({ status: 201, description: 'Country created successfully' })
  create(@Body() dto: UpdateCountryDto) {
    return this.countryService.createCountry(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Get(':id')
  @ApiOperation({ summary: 'Get a country by ID' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.countryService.getCountry(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a country' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCountryDto) {
    return this.countryService.updateCountry(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(3)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a country' })
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.countryService.deleteCountry(id);
  }
  
}
