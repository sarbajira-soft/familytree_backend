import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { RelationshipCustomLabel } from './model/relationship-custom-label.model';
import { Relationship } from './entities/relationship.model';
import { RelationshipTranslation } from './entities/relationship-translation.model';
import { RelationshipCustomLabelsService } from './relationship-custom-labels.service';
import { RelationshipCustomLabelsController } from './relationship-custom-labels.controller';
import { Family } from '../family/model/family.model';
import { RelationshipsModule } from './relationships.module';
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [
    SequelizeModule.forFeature([RelationshipCustomLabel, Relationship, RelationshipTranslation, Family]),
    forwardRef(() => RelationshipsModule),
  ],
  controllers: [RelationshipCustomLabelsController],
  providers: [RelationshipCustomLabelsService],
  exports: [RelationshipCustomLabelsService],
})
export class RelationshipCustomLabelsModule {} 