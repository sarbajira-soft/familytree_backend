import { UserProfile } from '../user/model/user-profile.model';
export function extractUserProfileFields(dto: any): Partial<UserProfile> {
  const allowedFields = [
    'firstName', 'lastName', 'gender', 'dob', 'profile', 'maritalStatus', 'marriageDate',
    'spouseName', 'childrenNames', 'fatherName', 'motherName',
    'religionId', 'languageId', 'caste', 'gothramId', 'kuladevata',
    'region', 'hobbies', 'likes','dislikes', 'favoriteFoods',
    'contactNumber', 'countryId', 'address', 'bio', 'familyCode'
  ];

  const result = {};
  for (const key of allowedFields) {
    if (dto[key] !== undefined) {
      result[key] = dto[key];
    }
  }

  return result;
}
