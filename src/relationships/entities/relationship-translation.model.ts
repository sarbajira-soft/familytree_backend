import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { Relationship } from './relationship.model';

@Table({ tableName: 'relationship_translations' })
export class RelationshipTranslation extends Model {
  @ForeignKey(() => Relationship)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  relationshipId: number;

  @BelongsTo(() => Relationship)
  relationship: Relationship;

  @Column({
    type: DataType.ENUM('en', 'ta', 'hi', 'ma', 'ka'),
    allowNull: false,
  })
  language: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  label: string;
}
