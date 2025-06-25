import { Table,Column, Model,DataType,Default,PrimaryKey,AutoIncrement,} from 'sequelize-typescript';

@Table({ tableName: 'ft_post' })
export class Post extends Model<Post> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  caption: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  postImage: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  privacy: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  familyCode: string;

  @Default(0)
  @Column(DataType.INTEGER)
  createdBy: number;

  @Default(1)
  @Column(DataType.INTEGER)
  status: number; // 1 = active, 0 = inactive
}
