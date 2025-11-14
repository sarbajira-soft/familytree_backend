import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Relationship } from './entities/relationship.model';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';

@Injectable()
export class RelationshipsService {
  constructor(
    @InjectModel(Relationship)
    private relationshipModel: typeof Relationship,

  ) {}

  async createRelationship(
    createDto: CreateRelationshipDto,
  ): Promise<Relationship> {
    return this.relationshipModel.create(createDto as any);
  }

  // Translation functionality moved to embedded columns - method deprecated

  async findAll(): Promise<Relationship[]> {
    return this.relationshipModel.findAll();
  }

  async findById(id: number): Promise<Relationship> {
    return this.relationshipModel.findByPk(id);
  }

  async findByKey(key: string): Promise<Relationship> {
    return this.relationshipModel.findOne({
      where: { key },
    });
  }

  async updateRelationship(
    id: number,
    updateDto: UpdateRelationshipDto,
  ): Promise<[number]> {
    return this.relationshipModel.update(updateDto as any, { where: { id } });
  }

  async updateRelationshipLabel(code: string, newDescription: string, newLabels: any) {
    const relationship = await this.relationshipModel.findOne({ where: { key: code } });
    if (!relationship) throw new Error('Relationship code not found');

    let changed = false;

    if (newDescription !== undefined && newDescription !== null && relationship.description !== newDescription) {
      relationship.description = newDescription;
      changed = true;
    }
    if (newLabels) {
      for (const [key, value] of Object.entries(newLabels)) {
        if (relationship[key] !== value) {
          relationship[key] = value;
          changed = true;
        }
      }
    }

    // Do NOT touch is_auto_generated at all!
    if (changed) {
      await relationship.save();
    }

    return relationship;
  }

  async deleteRelationship(id: number): Promise<void> {
    await this.relationshipModel.destroy({ where: { id } });
  }

  async getLabel(key: string, language: string, gender: string = 'f'): Promise<string> {
    const relationship = await this.findByKey(key);
    if (!relationship) return key; // Fallback to key

    // Use embedded language columns
    const genderSuffix = gender === 'm' ? '_m' : '_f';
    const languageField = `description_${language}${genderSuffix}`;
    
    return relationship[languageField] || 
           relationship[`description_${language}_f`] || // Fallback to female
           relationship.description ||
           relationship.key;
  }
}
