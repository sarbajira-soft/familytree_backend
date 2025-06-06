import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';

export function setupAssociations() {
    
    User.hasOne(UserProfile, { foreignKey: 'userId', as: 'userProfile',});

    UserProfile.belongsTo(User, { foreignKey: 'userId', as: 'userProfileOwner',});

}
