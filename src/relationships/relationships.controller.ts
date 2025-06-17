import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RelationshipsService } from './relationships.service';
import { Relationship } from './entities/relationship.model';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { CreateTranslationDto } from './dto/create-translation.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';

@ApiTags('Relationships')
@Controller('relationships')
export class RelationshipsController {
  constructor(private readonly relationshipsService: RelationshipsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new relationship' })
  @ApiResponse({
    status: 201,
    description: 'Relationship created',
    type: Relationship,
  })
  async create(
    @Body() createDto: CreateRelationshipDto,
  ): Promise<Relationship> {
    return this.relationshipsService.createRelationship(createDto);
  }

  @Post(':id/translations')
  @ApiOperation({ summary: 'Add translation to a relationship' })
  @ApiParam({ name: 'id', description: 'Relationship ID' })
  @ApiResponse({ status: 201, description: 'Translation added' })
  async addTranslation(
    @Param('id') id: number,
    @Body() createDto: CreateTranslationDto,
  ) {
    return this.relationshipsService.addTranslation(id, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all relationships with translations' })
  @ApiResponse({
    status: 200,
    description: 'List of relationships',
    type: [Relationship],
  })
  async findAll(): Promise<Relationship[]> {
    return this.relationshipsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get relationship by ID' })
  @ApiParam({ name: 'id', description: 'Relationship ID' })
  @ApiResponse({
    status: 200,
    description: 'Relationship details',
    type: Relationship,
  })
  async findOne(@Param('id') id: number): Promise<Relationship> {
    return this.relationshipsService.findById(id);
  }

  @Get('key/:key')
  @ApiOperation({ summary: 'Get relationship by key' })
  @ApiParam({ name: 'key', description: 'Relationship key' })
  @ApiResponse({
    status: 200,
    description: 'Relationship details',
    type: Relationship,
  })
  async findByKey(@Param('key') key: string): Promise<Relationship> {
    return this.relationshipsService.findByKey(key);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a relationship' })
  @ApiParam({ name: 'id', description: 'Relationship ID' })
  @ApiResponse({ status: 200, description: 'Relationship updated' })
  async update(
    @Param('id') id: number,
    @Body() updateDto: UpdateRelationshipDto,
  ) {
    return this.relationshipsService.updateRelationship(id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a relationship' })
  @ApiParam({ name: 'id', description: 'Relationship ID' })
  @ApiResponse({ status: 200, description: 'Relationship deleted' })
  async remove(@Param('id') id: number) {
    return this.relationshipsService.deleteRelationship(id);
  }

  @Get('label/:key')
  @ApiOperation({ summary: 'Get translated label for relationship' })
  @ApiParam({ name: 'key', description: 'Relationship key' })
  @ApiResponse({ status: 200, description: 'Translated label' })
  async getLabel(
    @Param('key') key: string,
    @Query('lang') language: string,
  ): Promise<string> {
    return this.relationshipsService.getLabel(key, language);
  }
}
