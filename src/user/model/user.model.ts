import { Table, Column, Model, DataType, Default } from 'sequelize-typescript';
import { HasManyGetAssociationsMixin, HasOneGetAssociationMixin } from 'sequelize';
import { FamilyMember } from '../../family/model/family-member.model';
import { FamilyTree } from '../../family/model/family-tree.model';
import { UserProfile } from './user-profile.model';

@Table({ tableName: 'ft_user' })
export class User extends Model<User> {
  @Column({ type: DataType.STRING, unique: true, allowNull: true })
  email: string;

  // New field for country code (e.g., +91, +1)
  @Column({ type: DataType.STRING, allowNull: true })
  countryCode: string;

  // Mobile without country code
  @Column({ type: DataType.STRING, unique: true, allowNull: true })
  mobile: string;

  @Column(DataType.STRING)
  password: string;

  @Column(DataType.STRING)
  otp: string;

  @Column(DataType.DATE)
  otpExpiresAt: Date;

  @Column(DataType.TEXT)
  accessToken: string;

  @Default(0)
  @Column(DataType.INTEGER)
  status: number; // 0=unverified, 1=active, 2=inactive, 3=pending_deletion

  @Default(1)
  @Column(DataType.INTEGER)
  role: number; // 1=member, 2=admin, 3=superadmin

  @Default(true)
  @Column(DataType.BOOLEAN)
  isAppUser: boolean;

  @Default(false)
  @Column(DataType.BOOLEAN)
  hasAcceptedTerms: boolean;

  @Column(DataType.STRING)
  termsVersion: string;

  @Column(DataType.DATE)
  termsAcceptedAt: Date;

  @Column(DataType.DATE)
  lastLoginAt: Date;

  @Column(DataType.DATE)
  verifiedAt: Date;

  @Default(0)
  @Column(DataType.INTEGER)
  createdBy: number;

  @Column({ type: DataType.STRING, allowNull: true })
  medusaCustomerId: string;

  @Column({ type: DataType.DATE, allowNull: true })
  deletedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  purgeAfter: Date;

  @Default('active')
  @Column({ type: DataType.STRING, allowNull: false })
  lifecycleState: string; // active | pending_deletion | purged

  userProfile?: UserProfile;
  familyMemberships?: FamilyMember[];
  familyTreeEntries?: FamilyTree[];

  // Optional: Add mixins for type safety
  public getUserProfile!: HasOneGetAssociationMixin<UserProfile>;
  public getFamilyMemberships!: HasManyGetAssociationsMixin<FamilyMember>;
  public getFamilyTreeEntries!: HasManyGetAssociationsMixin<FamilyTree>;
}
