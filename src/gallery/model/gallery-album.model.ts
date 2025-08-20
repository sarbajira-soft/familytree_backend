import {
  Table,
  Column,
  Model,
  DataType,
  Default,
  PrimaryKey,
  AutoIncrement,
} from 'sequelize-typescript';
 
@Table({ tableName: 'ft_gallery_album' })
export class GalleryAlbum extends Model<GalleryAlbum> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  album: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  galleryId: Number;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  createdAt: Date;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  updatedAt: Date;
}
