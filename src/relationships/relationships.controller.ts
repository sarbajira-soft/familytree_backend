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
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { RelationshipsService } from './relationships.service';
import { Relationship } from './entities/relationship.model';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
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

  // Translation endpoint deprecated - use embedded language columns in relationships table

  @Get()
  @ApiOperation({ summary: 'Get all relationships with embedded language support' })
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

  @Put('edit/:code')
  @ApiOperation({ summary: 'Edit a relationship label and mark as curated' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        description: { type: 'string', example: 'Universal relationship label (optional)' },
        labels: {
          type: 'object',
          properties: {
            description_en_f: { type: 'string', example: 'Sister' },
            description_en_m: { type: 'string', example: 'Brother' },
            description_ta_f: { type: 'string', example: 'அக்கா' },
            description_ta_m: { type: 'string', example: 'அண்ணா' },
            description_hi_f: { type: 'string', example: 'बहन' },
            description_hi_m: { type: 'string', example: 'भाई' },
            description_ma_f: { type: 'string', example: 'ചേച്ചി' },
            description_ma_m: { type: 'string', example: 'ചേട്ടൻ' },
            description_ka_f: { type: 'string', example: 'ಅಕ್ಕ' },
            description_ka_m: { type: 'string', example: 'ಅಣ್ಣ' },
            description_te_f: { type: 'string', example: 'అక్క' },
            description_te_m: { type: 'string', example: 'అన్న' }
          }
        }
      }
    }
  })
  async updateRelationshipLabel(
    @Param('code') code: string,
    @Body() body: { description: string, labels?: any }
  ) {
    return this.relationshipsService.updateRelationshipLabel(code, body.description, body.labels);
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
    @Query('gender') gender?: string,
  ): Promise<string> {
    return this.relationshipsService.getLabel(key, language, gender);
  }
}
