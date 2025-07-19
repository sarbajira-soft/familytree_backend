import { Table, Column, Model, DataType, HasMany } from 'sequelize-typescript';
import { RelationshipTranslation } from './relationship-translation.model';

@Table({ tableName: 'relationships' })
export class Relationship extends Model {
  @Column({
    type: DataType.STRING,
    unique: true,
    allowNull: false,
  })
  key: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  description: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_en: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_ta: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_hi: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_ma: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_ka: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_te: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: true,
    defaultValue: false,
  })
  is_auto_generated: boolean;

  @HasMany(() => RelationshipTranslation)
  translations: RelationshipTranslation[];
}
