import { Table, Column, Model, DataType, Default } from 'sequelize-typescript';
import { HasManyGetAssociationsMixin, HasOneGetAssociationMixin } from 'sequelize';
import { FamilyMember } from '../../family/model/family-member.model';
import { FamilyTree } from '../../family/model/family-tree.model';
import { UserProfile } from './user-profile.model';
import {
  buildEmailHash,
  buildMobileHash,
  decryptFieldValue,
  encryptFieldValue,
  normalizeEmailValue,
  normalizeMobileValue,
} from '../../common/security/field-encryption.util';

@Table({ tableName: 'ft_user' })
export class User extends Model<User> {
  @Column({
    type: DataType.TEXT,
    allowNull: true,
    get(this: User) {
      return decryptFieldValue(this.getDataValue('email'));
    },
    set(this: User, value: string | null) {
      const normalizedEmail = normalizeEmailValue(value);
      this.setDataValue('email', encryptFieldValue(normalizedEmail));
      this.setDataValue('emailHash', buildEmailHash(normalizedEmail));
    },
  })
  email: string;

  @Column({ type: DataType.STRING, allowNull: true })
  emailHash: string;

  // New field for country code (e.g., +91, +1)
  @Column({ type: DataType.STRING, allowNull: true })
  countryCode: string;

  // Mobile without country code
  @Column({
    type: DataType.TEXT,
    allowNull: true,
    get(this: User) {
      return decryptFieldValue(this.getDataValue('mobile'));
    },
    set(this: User, value: string | null) {
      const normalizedMobile = normalizeMobileValue(value);
      this.setDataValue('mobile', encryptFieldValue(normalizedMobile));
      this.setDataValue('mobileHash', buildMobileHash(normalizedMobile));
    },
  })
  mobile: string;

  @Column({ type: DataType.STRING, allowNull: true })
  mobileHash: string;

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

  @Column({ type: DataType.INTEGER, allowNull: true })
  deletedByAdminId: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  deletedByUserId: number;

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
