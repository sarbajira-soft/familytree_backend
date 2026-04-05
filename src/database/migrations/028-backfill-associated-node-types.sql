UPDATE public.ft_family_tree ft
SET "nodeType" = 'associated'
FROM public.ft_user_profile up
WHERE up."userId" = ft."userId"
  AND COALESCE(ft."isStructuralDummy", false) = false
  AND COALESCE(ft."isExternalLinked", false) = false
  AND COALESCE(NULLIF(TRIM(ft."nodeType"), ''), 'birth') = 'birth'
  AND UPPER(COALESCE(ft."familyCode", '')) <> UPPER(COALESCE(up."familyCode", ''));
