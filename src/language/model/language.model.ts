import { Table, Column, Model, DataType, Default } from 'sequelize-typescript';

@Table({ tableName: 'ft_language' })
export class Language extends Model<Language> {
  @Column({ type: DataType.STRING, unique: true, allowNull: false })
  name: string;

  @Column({ type: DataType.STRING, unique: true, allowNull: true })
  isoCode: string;

  @Default(0)
  @Column(DataType.INTEGER)
  status: number; // 1=active, 0=inactive

}