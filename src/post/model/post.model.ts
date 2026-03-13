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
    allowNull: true,
  })
  postVideo: string;

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

  @Default(true)
  @Column(DataType.BOOLEAN)
  isVisibleToFamily: boolean;

  @Default(true)
  @Column(DataType.BOOLEAN)
  isVisibleToPublic: boolean;

  @Column({ type: DataType.STRING, allowNull: true })
  hiddenReason: string;

  @Column({ type: DataType.STRING, allowNull: true })
  recoveryFamilyCode: string;
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  deletedAt: Date;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  deletedByUserId: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  deletedByAdminId: number;
} 
