export const PRIVACY_SCOPE_PRIVATE = 'PRIVATE';
export const PRIVACY_SCOPE_FAMILY = 'FAMILY';

export type PrivacyScope = 'PRIVATE' | 'FAMILY';
export type PrivacyRelation = 'self' | 'family' | 'other';

function normalizeScope(value: unknown): PrivacyScope {
  return String(value || PRIVACY_SCOPE_FAMILY).trim().toUpperCase() ===
    PRIVACY_SCOPE_PRIVATE
    ? PRIVACY_SCOPE_PRIVATE
    : PRIVACY_SCOPE_FAMILY;
}

export function canViewScopedField(
  scope: unknown,
  relation: PrivacyRelation,
): boolean {
  if (relation === 'self') {
    return true;
  }

  if (normalizeScope(scope) === PRIVACY_SCOPE_PRIVATE) {
    return false;
  }

  return relation === 'family';
}

export function resolvePhoneNumber(
  user: { mobile?: string | null; countryCode?: string | null } | null | undefined,
  userProfile:
    | { contactNumber?: string | null }
    | null
    | undefined,
): string | null {
  const contactNumber = String(userProfile?.contactNumber || '').trim();
  if (contactNumber) {
    return contactNumber;
  }

  const mobile = String(user?.mobile || '').trim();
  if (!mobile) {
    return null;
  }

  const countryCode = String(user?.countryCode || '').trim();
  return `${countryCode}${mobile}`.trim() || mobile;
}

export function applyPrivacyToNestedUser<T extends Record<string, any>>(
  user: T | null | undefined,
  relation: PrivacyRelation,
): T | null | undefined {
  if (!user) {
    return user;
  }

  const nextUser = { ...user } as any;
  const nextProfile = nextUser.userProfile
    ? { ...nextUser.userProfile }
    : undefined;

  const emailVisible = canViewScopedField(nextProfile?.emailPrivacy, relation);
  const phoneVisible = canViewScopedField(nextProfile?.phonePrivacy, relation);
  const addressVisible = canViewScopedField(nextProfile?.addressPrivacy, relation);

  if (!emailVisible) {
    nextUser.email = null;
  }

  if (!phoneVisible) {
    nextUser.mobile = null;
    nextUser.countryCode = null;
    if (nextProfile) {
      nextProfile.contactNumber = null;
    }
  } else if (nextProfile) {
    nextProfile.contactNumber = resolvePhoneNumber(nextUser, nextProfile);
  }

  if (!addressVisible && nextProfile) {
    nextProfile.address = null;
  }

  if (nextProfile) {
    nextProfile.privacySettings = {
      isPrivate: Boolean(nextProfile.isPrivate),
      emailPrivacy: normalizeScope(nextProfile.emailPrivacy),
      addressPrivacy: normalizeScope(nextProfile.addressPrivacy),
      phonePrivacy: normalizeScope(nextProfile.phonePrivacy),
    };
    nextProfile.fieldVisibility = {
      email: emailVisible,
      phone: phoneVisible,
      address: addressVisible,
    };
    nextUser.userProfile = nextProfile;
  }

  return nextUser as T;
}

export function applyPrivacyToProfileResponse<T extends Record<string, any>>(
  payload: T | null | undefined,
  relation: PrivacyRelation,
): T | null | undefined {
  if (!payload) {
    return payload;
  }

  const nextPayload = { ...payload } as any;
  const nextProfile = nextPayload.userProfile
    ? { ...nextPayload.userProfile }
    : undefined;

  const emailVisible = canViewScopedField(nextProfile?.emailPrivacy, relation);
  const phoneVisible = canViewScopedField(nextProfile?.phonePrivacy, relation);
  const addressVisible = canViewScopedField(nextProfile?.addressPrivacy, relation);

  if (!emailVisible) {
    nextPayload.email = null;
  }

  if (!phoneVisible) {
    nextPayload.mobile = null;
    nextPayload.countryCode = null;
    if (nextProfile) {
      nextProfile.contactNumber = null;
    }
  } else if (nextProfile) {
    nextProfile.contactNumber = resolvePhoneNumber(nextPayload, nextProfile);
  }

  if (!addressVisible && nextProfile) {
    nextProfile.address = null;
  }

  if (nextProfile) {
    nextProfile.privacySettings = {
      isPrivate: Boolean(nextProfile.isPrivate),
      emailPrivacy: normalizeScope(nextProfile.emailPrivacy),
      addressPrivacy: normalizeScope(nextProfile.addressPrivacy),
      phonePrivacy: normalizeScope(nextProfile.phonePrivacy),
    };
    nextProfile.fieldVisibility = {
      email: emailVisible,
      phone: phoneVisible,
      address: addressVisible,
    };
    nextPayload.userProfile = nextProfile;
  }

  return nextPayload as T;
}

