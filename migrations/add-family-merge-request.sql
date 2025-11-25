-- Create table for family merge requests
CREATE TABLE IF NOT EXISTS ft_family_merge_request (
    id SERIAL PRIMARY KEY,
    "primaryFamilyCode" VARCHAR(255) NOT NULL,
    "secondaryFamilyCode" VARCHAR(255) NOT NULL,
    "requestedByAdminId" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Helpful indexes for querying merge requests
CREATE INDEX IF NOT EXISTS idx_family_merge_primary_secondary
ON ft_family_merge_request ("primaryFamilyCode", "secondaryFamilyCode");

CREATE INDEX IF NOT EXISTS idx_family_merge_status
ON ft_family_merge_request (status);
