import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Post } from '../post/model/post.model';
import { FamilyMember } from '../family/model/family-member.model';

export function setupAssociations() {
  // UserProfile
  User.hasOne(UserProfile, { foreignKey: 'userId', as: 'userProfile' });
  UserProfile.belongsTo(User, { foreignKey: 'userId', as: 'profileOwner' });

  // FamilyMember ↔ UserProfile
  UserProfile.hasOne(FamilyMember, { foreignKey: 'memberId', sourceKey: 'userId', as: 'familyMember' });
  FamilyMember. belongsTo(UserProfile, { foreignKey: 'memberId', targetKey: 'userId', as: 'userProfile' });

  // Post
  Post.belongsTo(User, { as: 'author', foreignKey: 'authorId' });
  Post.belongsTo(User, { as: 'editor', foreignKey: 'editorId' });
}
