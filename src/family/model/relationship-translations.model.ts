import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({
  tableName: 'ft_relationship_translations',
  timestamps: true,
})
export class FtRelationshipTranslation extends Model {
  @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
  id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  languageCode: string; // e.g. 'ta', 'en'

  @Column({ type: DataType.INTEGER, allowNull: false })
  fromLevel: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  toLevel: number;

  @Column({ type: DataType.ENUM('male', 'female', 'other'), allowNull: false })
  fromGender: string;

  @Column({ type: DataType.ENUM('male', 'female', 'other'), allowNull: false })
  toGender: string;

  @Column({ type: DataType.STRING, allowNull: false })
  relationKey: string;

  @Column({ type: DataType.STRING, allowNull: false })
  relationName: string;

  @Column({ type: DataType.STRING, allowNull: false })
  notes: string;
}
