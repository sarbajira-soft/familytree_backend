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

  @HasMany(() => RelationshipTranslation)
  translations: RelationshipTranslation[];
}
