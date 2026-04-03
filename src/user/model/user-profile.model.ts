import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from './user.model';
import {
  decryptFieldValue,
  encryptFieldValue,
  normalizeDateValue,
} from '../../common/security/field-encryption.util';

@Table({ tableName: 'ft_user_profile', timestamps: true })
export class UserProfile extends Model<UserProfile> {
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @Column(DataType.STRING)
  firstName: string;

  @Column(DataType.STRING)
  lastName: string;
  
  @Column(DataType.STRING)
  profile: string; // profile photo URL or path

  @Column(DataType.STRING)
  gender: string;

  @Column({
    type: DataType.TEXT,
    get(this: UserProfile) {
      return decryptFieldValue(this.getDataValue('dob'));
    },
    set(this: UserProfile, value: string | null) {
      this.setDataValue('dob', encryptFieldValue(normalizeDateValue(value)));
    },
  })
  dob: string | Date;

  @Column(DataType.INTEGER)
  age: number;

  @Column(DataType.STRING)
  maritalStatus: string;

  @Column(DataType.DATE)
  marriageDate: Date;

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

  @Column(DataType.STRING)
  otherReligion: string;

  @Column(DataType.INTEGER)
  languageId: number;

  @Column(DataType.STRING)
  otherLanguage: string;

  @Column(DataType.STRING)
  caste: string;

  @Column(DataType.INTEGER)
  gothramId: number;

  @Column(DataType.STRING)
  otherGothram: string;

  @Column(DataType.STRING)
  kuladevata: string;

  @Column(DataType.STRING)
  region: string;

  @Column(DataType.TEXT)
  hobbies: string;

  @Column(DataType.TEXT)
  likes: string;

  @Column(DataType.TEXT)
  dislikes: string;

  @Column(DataType.TEXT)
  favoriteFoods: string;

  @Column({
    type: DataType.TEXT,
    get(this: UserProfile) {
      return decryptFieldValue(this.getDataValue('contactNumber'));
    },
    set(this: UserProfile, value: string | null) {
      this.setDataValue('contactNumber', encryptFieldValue(value));
    },
  })
  contactNumber: string;

  @Column(DataType.INTEGER)
  countryId: number;

  @Column({
    type: DataType.TEXT,
    get(this: UserProfile) {
      return decryptFieldValue(this.getDataValue('address'));
    },
    set(this: UserProfile, value: string | null) {
      this.setDataValue('address', encryptFieldValue(value));
    },
  })
  address: string;

  @Column(DataType.TEXT)
  bio: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  isPrivate: boolean;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: 'FAMILY',
  })
  emailPrivacy: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: 'FAMILY',
  })
  addressPrivacy: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: 'FAMILY',
  })
  phonePrivacy: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: 'FAMILY',
  })
  dobPrivacy: string;

  @Column(DataType.STRING)
  familyCode: string; // Main family code (birth family)

  @Column({
    type: DataType.JSON,
    allowNull: true,
    defaultValue: [],
  })
  associatedFamilyCodes: string[]; // Array of other family codes (in-laws, etc.)

  // Associations - these will be set up in sequelize.associations.ts
  religion?: any;
  language?: any;
  gothram?: any;
}


