import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Relationship } from '../entities/relationship.model';

@Table({ tableName: 'custom_labels' })
export class RelationshipCustomLabel extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id: number;

  @ForeignKey(() => Relationship)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  relationshipId: number;

  @BelongsTo(() => Relationship)
  relationship: Relationship;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  language: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  custom_label: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  creatorId: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  familyId: number;

  @Column({
    type: DataType.ENUM('global', 'family', 'user'),
    allowNull: false,
    defaultValue: 'global',
  })
  scope: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  updatedAt: Date;
} 