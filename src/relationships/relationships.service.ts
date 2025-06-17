import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Relationship } from './entities/relationship.model';
import { RelationshipTranslation } from './entities/relationship-translation.model';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { CreateTranslationDto } from './dto/create-translation.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';

@Injectable()
export class RelationshipsService {
  constructor(
    @InjectModel(Relationship)
    private relationshipModel: typeof Relationship,

    @InjectModel(RelationshipTranslation)
    private translationModel: typeof RelationshipTranslation,
  ) {}

  async createRelationship(
    createDto: CreateRelationshipDto,
  ): Promise<Relationship> {
    return this.relationshipModel.create(createDto as any);
  }

  async addTranslation(
    id: number,
    createDto: CreateTranslationDto,
  ): Promise<RelationshipTranslation> {
    return this.translationModel.create({
      relationshipId: id,
      ...createDto,
    } as any);
  }

  async findAll(): Promise<Relationship[]> {
    return this.relationshipModel.findAll({
      include: [RelationshipTranslation],
    });
  }

  async findById(id: number): Promise<Relationship> {
    return this.relationshipModel.findByPk(id, {
      include: [RelationshipTranslation],
    });
  }

  async findByKey(key: string): Promise<Relationship> {
    return this.relationshipModel.findOne({
      where: { key },
      include: [RelationshipTranslation],
    });
  }

  async updateRelationship(
    id: number,
    updateDto: UpdateRelationshipDto,
  ): Promise<[number]> {
    return this.relationshipModel.update(updateDto as any, { where: { id } });
  }

  async deleteRelationship(id: number): Promise<void> {
    await this.relationshipModel.destroy({ where: { id } });
  }

  async getLabel(key: string, language: string): Promise<string> {
    const relationship = await this.findByKey(key);
    if (!relationship) return key; // Fallback to key

    const translation = relationship.translations.find(
      (t) => t.language === language,
    );
    return translation?.label || relationship.key;
  }
}
