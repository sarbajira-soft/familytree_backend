import { Table, Column, Model, DataType, Default, PrimaryKey, AutoIncrement } from 'sequelize-typescript';

@Table({ tableName: 'ft_family' })
export class Family extends Model<Family> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  familyName: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  familyBio: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  familyPhoto: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  familyCode: string;

  @Default(1)
  @Column(DataType.INTEGER)
  status: number; // 1 = active, 0 = inactive

  @Default(0)
  @Column(DataType.INTEGER)
  createdBy: number;
}
