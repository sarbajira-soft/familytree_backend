import {
  Table,
  Column,
  Model,
  DataType,
  Default,
  PrimaryKey,
  AutoIncrement,
  HasMany,
} from 'sequelize-typescript';
import { GalleryAlbum } from './gallery-album.model'
 
@Table({ tableName: 'ft_gallery' })
export class Gallery extends Model<Gallery> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  galleryTitle: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  galleryDescription: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  coverPhoto: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  privacy: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
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

  @HasMany(() => GalleryAlbum, {
    foreignKey: 'galleryId',
    as: 'galleryAlbums',
  })
  galleryAlbums: GalleryAlbum[];

}
