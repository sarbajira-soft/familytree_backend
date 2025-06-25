import {
  Table,
  Column,
  Model,
  DataType,
  Default,
  PrimaryKey,
  AutoIncrement,
} from 'sequelize-typescript';

@Table({ tableName: 'ft_gallery_comment' })
export class GalleryComment extends Model<GalleryComment> {
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

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  comments: String;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  createdAt: Date;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  updatedAt: Date;
}
