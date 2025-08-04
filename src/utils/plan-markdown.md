# Step-by-Step Plan for Associated Family Tree Logic

## 1. What is an Associated Family Tree?

- In our system, a person can belong to multiple family trees (like WhatsApp groups).
- Each person has a main (birth) family tree and can be associated with other trees (e.g., through marriage).

## 2. How Do We Store This?

- Every person has:
  - `mainFamilyCode`: Their birth family’s unique code.
  - `associatedFamilyCodes`: List of other family codes they are linked to (e.g., spouse’s family).
- In the database, each family tree is a flat list of members, with relationships (parents, children, spouses, siblings) stored as arrays of person IDs.

## 3. Adding a Spouse or Associated Member

- When a spouse is added from another family, their family code is added to the member’s `associatedFamilyCodes`.
- In the UI, we show a "View Family Tree" option for each associated family.

## 4. Syncing Common Members

- If a person is present in multiple trees (e.g., as a child in one, as a spouse in another), any update to their profile or relationships is reflected in all trees where they appear.
- This is done by using a unique `userId` or `personId` across all trees.

## 5. Manual Creation of Associated Trees

- Sometimes, a user (e.g., a spouse) may manually create a new family tree for themselves, with minimal information.
- This tree is marked as `isManual = true` in the database.

## 6. Automatic Replacement with Complete Tree

- Later, if more family members (like parents or siblings) are added for this user, the system will auto-generate a more complete family tree.
- The system will then:
  - Replace the manual tree with the auto-generated one.
  - Update all references in other trees to point to the new, complete tree.
  - Optionally, merge any unique data from the manual tree and notify the user/admin.

## 7. Tracking a Person Across Trees

- At any time, we can find all the family trees a person is part of by searching for their `userId` or `personId` in the database.
- This helps us show where a person is present (main tree and all associated trees).

## 8. User Experience

- In the app, users can easily navigate between their main family tree and associated trees.
- When a new tree is created or updated, all relevant links and data are kept in sync automatically.

## 9. Data Integrity and Permissions

- All updates are done using transactions to ensure data consistency.
- Only authorized users can edit a tree.
- An audit log is maintained for all changes.

## 10. Future-Proofing

- If an associated member wants to create their own detailed tree later, the system will handle the transition smoothly, replacing the old manual tree with the new one and updating all links.

### Summary Table

| Field                 | Description                           |
| --------------------- | ------------------------------------- |
| mainFamilyCode        | The person’s birth/main family code   |
| associatedFamilyCodes | Other family codes (in-laws, etc.)    |
| isManual              | Whether the tree was created manually |
| personId/userId       | Unique identifier for the person      |

## Diagram (Conceptual)

[See system documentation for diagram]

## In Short (Tamil Summary)

- Oru person-ku main family code irukum, matra family codes associated list-la store pannuvom.
- Spouse add pannina, avanga family code associated list-ku add aagum.
- Manual tree create panninaalum, later full family add aana auto-generated tree replace aagum.
- Ellā updates, links, and data sync automatic-a nadakkum.

This plan ensures clarity, data integrity, and a smooth user experience for handling complex family relationships.
