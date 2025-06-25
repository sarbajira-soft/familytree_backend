import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, Default } from 'sequelize-typescript';

@Table({ tableName: 'ft_post_like' })
export class PostLike extends Model<PostLike> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  postId: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  userId: number;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  createdAt: Date;
}
