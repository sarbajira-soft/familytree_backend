import { Table, Column, Model, DataType, Default } from 'sequelize-typescript';

@Table({ tableName: 'ft_religion' })
export class Religion extends Model<Religion> {
  @Column({ type: DataType.STRING, unique: true, allowNull: false })
  name: string;

  @Default(0)
  @Column(DataType.INTEGER)
  status: number; // 1=active, 0=inactive

}