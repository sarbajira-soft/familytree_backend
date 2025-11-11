# 🗄️ Database Migration

**Complete database schema for Family Tree Management System**

---

## 📁 Files:

```
1. complete-schema-v2.sql - Complete database schema (29 tables + 60 indexes)
2. run-migration.js       - Migration runner script
```

---

## 📊 Database Schema:

### Tables: 29
All tables verified from Sequelize models

### Indexes: 60
Performance-optimized indexes for fast queries

### Features:
- ✅ All foreign keys
- ✅ All constraints
- ✅ Default values
- ✅ Timestamps
- ✅ Safe to run multiple times (IF NOT EXISTS)

---

## 🚀 How to Run Migration:

### Option 1: Using Node.js Script (Recommended)
```bash
node migrations/run-migration.js
```

**Benefits:**
- ✅ Uses .env configuration
- ✅ Shows progress
- ✅ Verifies completion
- ✅ Error handling

### Option 2: Using psql
```bash
psql -h YOUR_HOST -p 5432 -U YOUR_USER -d YOUR_DB -f migrations/complete-schema-v2.sql
```

### For Both Options:
- ✅ Safe to run on new database
- ✅ Safe to run on existing database
- ✅ Uses `IF NOT EXISTS` clauses
- ✅ No data loss

---

## 📋 Tables Created (29):

### Core Tables (3):
1. **ft_user** - User authentication
2. **ft_user_profile** - User profiles
3. **ft_user_relationships** - User relationships

### Family Tables (3):
4. **ft_family** - Family definitions
5. **ft_family_members** - Family membership
6. **ft_family_tree** - Family tree structure

### Notification Tables (3):
7. **ft_invite** - Invitations
8. **ft_notifications** - Notifications
9. **ft_notification_recipients** - Recipients

### Social Tables (3):
10. **ft_post** - Posts/stories
11. **ft_post_comment** - Comments
12. **ft_post_like** - Likes

### Event Tables (2):
13. **ft_event** - Events
14. **ft_event_image** - Event images

### Gallery Tables (4):
15. **ft_gallery** - Gallery
16. **ft_gallery_album** - Albums
17. **ft_gallery_comment** - Gallery comments
18. **ft_gallery_like** - Gallery likes

### Product Tables (4):
19. **ft_product** - Products
20. **ft_product_image** - Product images
21. **ft_category** - Categories
22. **ft_order** - Orders

### Reference Tables (4):
23. **ft_country** - Countries
24. **ft_language** - Languages
25. **ft_religion** - Religions
26. **ft_gothram** - Gothram/Gotra

### Relationship Tables (3):
27. **relationships** - Relationship definitions
28. **relationship_translations** - Translations
29. **custom_labels** - Custom labels

---

## ⚡ Performance Indexes (60):

### Critical Indexes:
- **ft_family_tree**: 10 indexes (family_code, user_id, generation, etc.)
- **ft_family_members**: 8 indexes (family_code, member_id, status, etc.)
- **ft_user_profile**: 10 indexes (user_id, family_code, name, etc.)
- **ft_user**: 6 indexes (email, mobile, role, etc.)
- **ft_user_relationships**: 6 indexes (user1_id, user2_id, type, etc.)
- **ft_notifications**: 8 indexes (type, status, created_at, etc.)
- **ft_family**: 6 indexes (family_code, created_by, etc.)
- **ft_post**: 4 indexes (user_id, family_code, created_at, etc.)
- **ft_gallery**: 2 indexes (family_code, created_at)

---

## ✅ Verification:

After running the migration:

```sql
-- Check table count
SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';
-- Expected: 29

-- Check indexes
SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';
-- Expected: 60+

-- List all tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

---

## 🔒 Safety Features:

- ✅ Uses `IF NOT EXISTS` - won't fail on existing tables
- ✅ Uses `CASCADE` on foreign keys where appropriate
- ✅ Proper data types and constraints
- ✅ Timestamps on all tables
- ✅ Unique constraints where needed

---

## 📝 Notes:

### Table Naming Convention:
- Most tables use **singular** names: `ft_post`, `ft_event`, `ft_product`
- Some use **plural** names: `ft_family_members`, `ft_notifications`
- This matches the Sequelize model definitions exactly

### Key Points:
- All table names verified from actual model files
- No duplicate tables
- Clean, optimized structure
- Production-ready

---

**Status:** ✅ Production Ready  
**Version:** 2.0  
**Last Updated:** October 25, 2025
