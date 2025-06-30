import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Post } from '../post/model/post.model';
import { Gallery } from '../gallery/model/gallery.model';
import { PostComment } from '../post/model/post-comment.model';
import { GalleryComment } from '../gallery/model/gallery-comment.model';
import { FamilyMember } from '../family/model/family-member.model';

export function setupAssociations() {
  // UserProfile
  User.hasOne(UserProfile, { foreignKey: 'userId', as: 'userProfile' });
  UserProfile.belongsTo(User, { foreignKey: 'userId', as: 'profileOwner' });

  // Post ↔ User
  Post.belongsTo(User, { foreignKey: 'createdBy', as: 'user' });
  Post.belongsTo(UserProfile, { foreignKey: 'createdBy', targetKey: 'userId', as: 'userProfile' });

  // PostComment ↔ User
  PostComment.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  PostComment.belongsTo(UserProfile, { foreignKey: 'userId', targetKey: 'userId', as: 'userProfile' });

  // Gallery ↔ User
  Gallery.belongsTo(User, { foreignKey: 'createdBy', as: 'user' });
  Gallery.belongsTo(UserProfile, { foreignKey: 'createdBy', targetKey: 'userId', as: 'userProfile' });

  // GalleryComment ↔ User
  GalleryComment.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  GalleryComment.belongsTo(UserProfile, { foreignKey: 'userId', targetKey: 'userId', as: 'userProfile' });

  // FamilyMember ↔ User (Member and Creator)
  User.hasMany(FamilyMember, { foreignKey: 'memberId', as: 'familyMemberships' });
  FamilyMember.belongsTo(User, { foreignKey: 'memberId', as: 'user' });      // memberId -> user
  FamilyMember.belongsTo(User, { foreignKey: 'creatorId', as: 'creator' });  // creatorId -> creator
  
  UserProfile.hasOne(FamilyMember, { foreignKey: 'memberId', sourceKey: 'userId', as: 'familyMember' });
  FamilyMember.belongsTo(UserProfile, { foreignKey: 'memberId', targetKey: 'userId', as: 'userProfile' });
}
