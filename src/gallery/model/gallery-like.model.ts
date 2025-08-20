import {
  Table,
  Column,
  Model,
  DataType,
  Default,
  PrimaryKey,
  AutoIncrement,
} from 'sequelize-typescript';
 
@Table({ tableName: 'ft_gallery_like' })
export class GalleryLike extends Model<GalleryLike> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  galleryId: Number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId: Number;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  createdAt: Date;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  updatedAt: Date;
}
