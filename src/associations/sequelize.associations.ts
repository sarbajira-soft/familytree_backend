import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Post } from '../post/model/post.model';
import { PostComment } from '../post/model/post-comment.model';
import { FamilyMember } from '../family/model/family-member.model';

export function setupAssociations() {
  // UserProfile
  User.hasOne(UserProfile, { foreignKey: 'userId', as: 'userProfile' });
  UserProfile.belongsTo(User, { foreignKey: 'userId', as: 'profileOwner' });

  // FamilyMember ↔ UserProfile
  UserProfile.hasOne(FamilyMember, { foreignKey: 'memberId', sourceKey: 'userId', as: 'familyMember' });
  FamilyMember. belongsTo(UserProfile, { foreignKey: 'memberId', targetKey: 'userId', as: 'userProfile' });

  PostComment.belongsTo(User, { foreignKey: 'userId', as: 'user' });

}
