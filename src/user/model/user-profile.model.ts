import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from './user.model';

@Table({ tableName: 'ft_user_profile', timestamps: true })
export class UserProfile extends Model<UserProfile> {
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @Column(DataType.STRING)
  profile: string; // profile photo URL or path

  @Column(DataType.STRING)
  gender: string;

  @Column(DataType.DATE)
  dob: Date;

  @Column(DataType.INTEGER)
  age: number;

  @Column(DataType.STRING)
  maritalStatus: string;

  @Column(DataType.STRING)
  spouseName: string;

  @Column(DataType.TEXT)
  childrenNames: string;

  @Column(DataType.STRING)
  fatherName: string;

  @Column(DataType.STRING)
  motherName: string;

  @Column(DataType.INTEGER)
  religionId: number;

  @Column(DataType.INTEGER)
  languageId: number;

  @Column(DataType.STRING)
  caste: string;

  @Column(DataType.INTEGER)
  gothramId: number;

  @Column(DataType.STRING)
  kuladevata: string;

  @Column(DataType.STRING)
  region: string;

  @Column(DataType.TEXT)
  hobbies: string;

  @Column(DataType.TEXT)
  likesDislikes: string;

  @Column(DataType.TEXT)
  favoriteFoods: string;

  @Column(DataType.STRING)
  contactNumber: string;

  @Column(DataType.INTEGER)
  countryId: number;

  @Column(DataType.TEXT)
  address: string;

  @Column(DataType.TEXT)
  bio: string;

  @Column(DataType.STRING)
  familyCode: string;
}
