import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { RelationshipCustomLabel } from './model/relationship-custom-label.model';
import { Relationship } from './entities/relationship.model';
import { RelationshipTranslation } from './entities/relationship-translation.model';
import { Family } from '../family/model/family.model';
import { BadRequestException } from '@nestjs/common';
import { RelationshipsService } from './relationships.service';

@Injectable()
export class RelationshipCustomLabelsService {
  constructor(
    @InjectModel(RelationshipCustomLabel)
    private customLabelModel: typeof RelationshipCustomLabel,
    @InjectModel(Relationship)
    private relationshipModel: typeof Relationship,
    @InjectModel(RelationshipTranslation)
    private translationModel: typeof RelationshipTranslation,
    @InjectModel(Family)
    private familyModel: typeof Family,
    private relationshipsService: RelationshipsService,
  ) {}

  // Helper to map UI language to DB enum
  private mapLanguage(lang: string): string {
    const langMap: Record<string, string> = {
      english: 'en', en: 'en',
      tamil: 'ta', ta: 'ta',
      hindi: 'hi', hi: 'hi',
      telugu: 'te', te: 'te',
      malayalam: 'ma', ma: 'ma',
      kannada: 'ka', ka: 'ka',
    };
    return langMap[lang] || 'en';
  }

  // Accepts query object with correct param names from controller
  async getCustomLabel({ relationshipKey, language, creatorId, familyCode }: { relationshipKey: string, language: string, creatorId: string, familyCode: string }): Promise<any> {
    language = this.mapLanguage(language);
    if (!relationshipKey || !language || !creatorId || !familyCode || creatorId === 'undefined' || familyCode === 'undefined' || creatorId === 'NaN' || familyCode === 'NaN') {
      throw new BadRequestException('Missing or invalid required parameters');
    }
    // 1. Find relationshipId by key
    const relationship = await this.relationshipModel.findOne({ where: { key: relationshipKey } });
    if (!relationship) return relationshipKey;
    const relationshipId = relationship.id;

    // 2. Find familyId from familyCode if provided
    let familyId = undefined;
    if (familyCode) {
      const family = await this.familyModel.findOne({ where: { familyCode } });
      if (family) familyId = family.id;
    }

    // 3. Try user-specific
    let label = await this.customLabelModel.findOne({
      where: { relationshipId, language, creatorId, scope: 'user' },
    });
    if (label) return label.custom_label;

    // 4. Try family-specific
    if (familyId) {
      label = await this.customLabelModel.findOne({
        where: { relationshipId, language, familyId, scope: 'family' },
      });
      if (label) return label.custom_label;
    }

    // 5. Try global
    label = await this.customLabelModel.findOne({
      where: { relationshipId, language, scope: 'global' },
    });
    if (label) return label.custom_label;

    // 6. Fallback to default translation
    const translation = await this.translationModel.findOne({
      where: { relationshipId, language },
    });
    if (translation) return translation.label;

    // 7. Fallback to static description from relationships table (multi-language)
    if (relationship[`description_${language}`]) return relationship[`description_${language}`];
    // 8. Fallback to key
    return relationshipKey;
  }

  async upsertCustomLabel({
    relationshipKey,
    language,
    custom_label,
    creatorId,
    familyCode,
    scope,
    gender
  }: {
    relationshipKey: string,
    language: string,
    custom_label: string,
    creatorId: number,
    familyCode?: string,
    scope: string,
    gender?: string
  }) {
    language = this.mapLanguage(language);
    // Find relationshipId by key
    const relationship = await this.relationshipModel.findOne({ where: { key: relationshipKey } });
    if (!relationship) throw new Error('Relationship not found');
    const relationshipId = relationship.id;

    // Find familyId from familyCode if provided
    let familyId = undefined;
    if (familyCode) {
      const family = await this.familyModel.findOne({ where: { familyCode } });
      if (!family) throw new Error('Family not found');
      familyId = family.id;
    }

    // Upsert logic
    const [label, created] = await this.customLabelModel.findOrCreate({
      where: { relationshipId, language, creatorId, familyId, scope },
      defaults: { custom_label },
    });
    if (!created) {
      label.custom_label = custom_label;
      await label.save();
    }

    // Also update the main relationship label and set is_auto_generated to false
    let labelField = `description_${language}_f`; // default to female
    if (gender?.toLowerCase() === 'male') {
      labelField = `description_${language}_m`;
    }
    await this.relationshipsService.updateRelationshipLabel(
      relationshipKey,
      undefined, // don't update main description
      { [labelField]: custom_label }
    );
    console.log('Called updateRelationshipLabel for', relationshipKey, labelField, custom_label);

    return label;
  }

  async getAllLabels({ language, creatorId, familyCode, gender }: { language: string, creatorId?: string, familyCode?: string, gender?: string }) {
    language = this.mapLanguage(language);
    // 1. Get all relationships
    const relationships = await this.relationshipModel.findAll();
    // 2. Get all translations for the language
    const translations = await this.translationModel.findAll({ where: { language } });
    // 3. Get all custom labels for this user/family/language
    let familyId = undefined;
    if (familyCode) {
      const family = await this.familyModel.findOne({ where: { familyCode } });
      if (family) familyId = family.id;
    }
    const where: any = { language, creatorId };
    if (familyId) where.familyId = familyId;
    // gender is available here if you want to use it in the future
    const customLabels = await this.customLabelModel.findAll({ where });
    // 4. Build a map: { code: label }
    const labelMap: Record<string, string> = {};
    for (const rel of relationships) {
      // Priority: custom label > translation > gender-specific description > default description > key
      const custom = customLabels.find(c => c.relationshipId === rel.id);
      const translation = translations.find(t => t.relationshipId === rel.id);

      // Determine gender suffix. Default to '_f' because 'description_ta' was renamed to 'description_ta_f'.
      let genderSuffix = '_f';
      if (gender?.toLowerCase() === 'male') {
        genderSuffix = '_m';
      }

      labelMap[rel.key] =
        custom?.custom_label ||
        translation?.label ||
        rel[`description_${language}${genderSuffix}`] || // Tries description_ta_m or description_ta_f
        rel[`description_${language}_f`] || // Fallback to female if the male one doesn't exist
        rel.description ||
        rel.key;
    }
    return labelMap;
  }
} 