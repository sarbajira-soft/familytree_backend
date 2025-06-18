import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { FtFamilyPosition } from '../family/model/family-position.model';
import { Post } from '../post/model/post.model';

export function setupAssociations() {
  // UserProfile
  User.hasOne(UserProfile, { foreignKey: 'userId', as: 'userProfile' });
  UserProfile.belongsTo(User, { foreignKey: 'userId', as: 'profileOwner' });

  // FtFamilyPosition (associates to User twice)
  FtFamilyPosition.belongsTo(UserProfile, { foreignKey: 'userId', targetKey: 'userId', as: 'familyUser' });

  // Post
  Post.belongsTo(User, { as: 'author', foreignKey: 'authorId' });
  Post.belongsTo(User, { as: 'editor', foreignKey: 'editorId' });
}
