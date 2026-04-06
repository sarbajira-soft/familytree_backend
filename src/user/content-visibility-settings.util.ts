export type FamilyContentVisibilityType = 'posts' | 'albums' | 'events';
export type FamilyContentVisibilityMode = 'all-members' | 'specific-family';

export type FamilyContentVisibilityEntry = {
  visibility: FamilyContentVisibilityMode;
  familyCodes: string[];
};

export type FamilyContentVisibilitySettings = {
  posts: FamilyContentVisibilityEntry;
  albums: FamilyContentVisibilityEntry;
  events: FamilyContentVisibilityEntry;
};

export const DEFAULT_FAMILY_CONTENT_VISIBILITY_ENTRY: FamilyContentVisibilityEntry = {
  visibility: 'all-members',
  familyCodes: [],
};

export const DEFAULT_FAMILY_CONTENT_VISIBILITY_SETTINGS: FamilyContentVisibilitySettings = {
  posts: { ...DEFAULT_FAMILY_CONTENT_VISIBILITY_ENTRY },
  albums: { ...DEFAULT_FAMILY_CONTENT_VISIBILITY_ENTRY },
  events: { ...DEFAULT_FAMILY_CONTENT_VISIBILITY_ENTRY },
};

function normalizeFamilyCode(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeFamilyCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => normalizeFamilyCode(item))
        .filter(Boolean),
    ),
  );
}

function normalizeEntry(value: unknown): FamilyContentVisibilityEntry {
  if (typeof value === 'boolean') {
    return value
      ? { visibility: 'all-members', familyCodes: [] }
      : { visibility: 'specific-family', familyCodes: [] };
  }

  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const visibility = source.visibility === 'specific-family' ? 'specific-family' : 'all-members';
  const familyCodes = normalizeFamilyCodes(source.familyCodes);

  return {
    visibility,
    familyCodes,
  };
}

export function normalizeFamilyContentVisibilitySettings(
  value: unknown,
): FamilyContentVisibilitySettings {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    posts: normalizeEntry(source.posts),
    albums: normalizeEntry(source.albums),
    events: normalizeEntry(source.events),
  };
}

export function mergeFamilyContentVisibilitySettings(
  currentValue: unknown,
  patchValue: unknown,
): FamilyContentVisibilitySettings {
  const current = normalizeFamilyContentVisibilitySettings(currentValue);
  const patch = patchValue && typeof patchValue === 'object' ? (patchValue as Record<string, unknown>) : {};

  return {
    posts: patch.posts === undefined ? current.posts : normalizeEntry(patch.posts),
    albums: patch.albums === undefined ? current.albums : normalizeEntry(patch.albums),
    events: patch.events === undefined ? current.events : normalizeEntry(patch.events),
  };
}

export function filterFamilyContentVisibilitySettings(
  value: unknown,
  allowedFamilyCodes: string[],
): FamilyContentVisibilitySettings {
  const normalizedAllowed = normalizeFamilyCodes(allowedFamilyCodes);
  const settings = normalizeFamilyContentVisibilitySettings(value);
  const filterEntry = (entry: FamilyContentVisibilityEntry): FamilyContentVisibilityEntry => ({
    visibility: entry.visibility,
    familyCodes:
      entry.visibility === 'specific-family'
        ? entry.familyCodes.filter((code) => normalizedAllowed.includes(code))
        : [],
  });

  return {
    posts: filterEntry(settings.posts),
    albums: filterEntry(settings.albums),
    events: filterEntry(settings.events),
  };
}
export function isFamilyContentVisibleForType(
  value: unknown,
  type: FamilyContentVisibilityType,
): boolean {
  const entry = normalizeFamilyContentVisibilitySettings(value)[type];
  return entry.visibility === 'all-members' || entry.familyCodes.length > 0;
}

export function getAllowedFamilyCodesForType(
  value: unknown,
  type: FamilyContentVisibilityType,
): string[] {
  return normalizeFamilyContentVisibilitySettings(value)[type].familyCodes;
}

function getEffectiveAllowedFamilyCodesForType(
  value: unknown,
  type: FamilyContentVisibilityType,
  creatorAudienceFamilyCodes: string[],
): string[] {
  const entry = normalizeFamilyContentVisibilitySettings(value)[type];
  if (entry.visibility === 'all-members') {
    return normalizeFamilyCodes(creatorAudienceFamilyCodes);
  }
  return entry.familyCodes;
}

export function canViewerAccessFamilyContentForType(
  creatorValue: unknown,
  type: FamilyContentVisibilityType,
  viewerFamilyCodes: string[],
  creatorAudienceFamilyCodes: string[] = viewerFamilyCodes,
): boolean {
  const normalizedViewerCodes = normalizeFamilyCodes(viewerFamilyCodes);
  if (!normalizedViewerCodes.length) {
    return false;
  }

  const creatorAllowedCodes = getEffectiveAllowedFamilyCodesForType(
    creatorValue,
    type,
    creatorAudienceFamilyCodes,
  );
  if (!creatorAllowedCodes.length) {
    return false;
  }

  return normalizedViewerCodes.some((code) => creatorAllowedCodes.includes(code));
}


