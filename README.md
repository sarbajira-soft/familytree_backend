# familytree_backend

## Admin login

### Endpoint

`POST /admin/login`

Body:

- **email**
- **password**

Response:

- **accessToken**
- **admin** (profile)

## Create initial superadmin (CLI)

Run this from the backend folder:

```bash
npm run admin:create-superadmin -- --email superadmin@example.com --password "StrongPassword@123" --name "Super Admin"
```

Notes:

- The script will **create** the superadmin if the email does not exist.
- If the email already exists, it will **update** the existing row and promote it to `superadmin`.



## For mirating the old data - email,phone etc to hashed/masked
```bash
 npm run migrate:sensitive-user-data 
```

## Encryption key 
The encryption key is stored in the `.env` file as `DATA_ENCRYPTION_KEY` and `DATA_HASH_KEY`. - must be take care , once key is lost the data which are encrypted using those keys wont be accessible.
