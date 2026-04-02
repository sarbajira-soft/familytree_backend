export const CONTENT_PRIVACY_TYPES = ['posts', 'albums', 'events'] as const;
export type ContentPrivacyType = (typeof CONTENT_PRIVACY_TYPES)[number];

export const CONTENT_PRIVACY_VISIBILITIES = [
  'ALL_MEMBERS',
  'SPECIFIC_FAMILIES',
] as const;
export type ContentPrivacyVisibility =
  (typeof CONTENT_PRIVACY_VISIBILITIES)[number];

export interface ContentPrivacyEntry {
  visibility: ContentPrivacyVisibility;
  familyCodes: string[];
}

export interface ContentPrivacySettings {
  posts: ContentPrivacyEntry;
  albums: ContentPrivacyEntry;
  events: ContentPrivacyEntry;
}

const DEFAULT_VISIBILITY: ContentPrivacyVisibility = 'ALL_MEMBERS';

export function normalizeFamilyCode(value: unknown): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized ? normalized : null;
}

export function normalizeFamilyCodes(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  return Array.from(
    new Set(
      rawValues
        .map((entry) => normalizeFamilyCode(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  );
}

export function createDefaultContentPrivacyEntry(): ContentPrivacyEntry {
  return {
    visibility: DEFAULT_VISIBILITY,
    familyCodes: [],
  };
}

export function buildDefaultContentPrivacySettings(): ContentPrivacySettings {
  return {
    posts: createDefaultContentPrivacyEntry(),
    albums: createDefaultContentPrivacyEntry(),
    events: createDefaultContentPrivacyEntry(),
  };
}

function normalizeVisibility(value: unknown): ContentPrivacyVisibility {
  const normalized = String(value || '').trim().toUpperCase();

  if (
    normalized === 'SPECIFIC_FAMILIES' ||
    normalized === 'SPECIFIC_FAMILY' ||
    normalized === 'SPECIFIC-FAMILIES' ||
    normalized === 'SPECIFIC-FAMILY'
  ) {
    return 'SPECIFIC_FAMILIES';
  }

  return DEFAULT_VISIBILITY;
}

export function normalizeContentPrivacyEntry(value: unknown): ContentPrivacyEntry {
  if (!value || typeof value !== 'object') {
    return createDefaultContentPrivacyEntry();
  }

  const rawEntry = value as Record<string, unknown>;
  const rawFamilyCodes =
    rawEntry.familyCodes !== undefined ? rawEntry.familyCodes : rawEntry.familyCode;

  return {
    visibility: normalizeVisibility(rawEntry.visibility),
    familyCodes: normalizeFamilyCodes(rawFamilyCodes),
  };
}

export function normalizeContentPrivacySettings(
  value: unknown,
): ContentPrivacySettings {
  const defaults = buildDefaultContentPrivacySettings();
  const rawValue = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    posts: normalizeContentPrivacyEntry(rawValue.posts ?? defaults.posts),
    albums: normalizeContentPrivacyEntry(rawValue.albums ?? defaults.albums),
    events: normalizeContentPrivacyEntry(rawValue.events ?? defaults.events),
  };
}

export function mergeContentPrivacySettings(
  currentValue: unknown,
  updatesValue: unknown,
): ContentPrivacySettings {
  const current = normalizeContentPrivacySettings(currentValue);
  const updates =
    updatesValue && typeof updatesValue === 'object'
      ? (updatesValue as Record<string, unknown>)
      : {};

  return {
    posts:
      updates.posts !== undefined
        ? normalizeContentPrivacyEntry(updates.posts)
        : current.posts,
    albums:
      updates.albums !== undefined
        ? normalizeContentPrivacyEntry(updates.albums)
        : current.albums,
    events:
      updates.events !== undefined
        ? normalizeContentPrivacyEntry(updates.events)
        : current.events,
  };
}

export function canViewContent(
  viewerFamilyCodes: unknown,
  ownerSettings: unknown,
  type: ContentPrivacyType,
  viewerId?: number | null,
  ownerId?: number | null,
): boolean {
  const normalizedViewerId = Number(viewerId);
  const normalizedOwnerId = Number(ownerId);

  if (
    Number.isFinite(normalizedViewerId) &&
    Number.isFinite(normalizedOwnerId) &&
    normalizedViewerId > 0 &&
    normalizedOwnerId > 0 &&
    normalizedViewerId === normalizedOwnerId
  ) {
    return true;
  }

  const settings = normalizeContentPrivacySettings(ownerSettings);
  const entry = settings[type];

  if (entry.visibility === 'ALL_MEMBERS') {
    return true;
  }

  if (entry.visibility === 'SPECIFIC_FAMILIES') {
    const viewerCodes = new Set(normalizeFamilyCodes(viewerFamilyCodes));
    if (viewerCodes.size === 0 || entry.familyCodes.length === 0) {
      return false;
    }

    return entry.familyCodes.some((familyCode) => viewerCodes.has(familyCode));
  }

  return false;
}
