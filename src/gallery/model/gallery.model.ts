import {
  Table,
  Column,
  Model,
  DataType,
  Default,
  PrimaryKey,
  AutoIncrement,
} from 'sequelize-typescript';

@Table({ tableName: 'ft_gallery' })
export class Gallery extends Model<Gallery> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({
    type: DataType.JSON, // Store array of image filenames as JSON
    allowNull: false,
  })
  images: string; // Will store JSON string of image array

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  familyCode: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  createdBy: number;

  @Default(1)
  @Column(DataType.INTEGER)
  status: number; // 1 = active, 0 = inactive

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  createdAt: Date;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  updatedAt: Date;
}
