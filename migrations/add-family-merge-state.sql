-- Create table for family merge state/cache
CREATE TABLE IF NOT EXISTS ft_family_merge_state (
    id SERIAL PRIMARY KEY,
    "mergeRequestId" INTEGER NOT NULL REFERENCES ft_family_merge_request(id) ON DELETE CASCADE,
    "primaryFamilyCode" VARCHAR(255) NOT NULL,
    "secondaryFamilyCode" VARCHAR(255) NOT NULL,
    state JSONB,
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_state_request
ON ft_family_merge_state ("mergeRequestId");

CREATE INDEX IF NOT EXISTS idx_merge_state_families
ON ft_family_merge_state ("primaryFamilyCode", "secondaryFamilyCode");
