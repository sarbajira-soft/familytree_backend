// Example usage of Family Tree API
// This file demonstrates how to use the family tree endpoints

/*
Example payload structure (as provided by the user):

[
    {
        "id": 1,
        "name": "Raman Developer",
        "gender": "Male",
        "age": 29,
        "img": "http://localhost:3000/uploads/profile/FT-1751513205069-680937700.jpg",
        "generation": 1,
        "parents": [3, 4],
        "children": [],
        "spouses": [2],
        "siblings": [],
        "userId": 1
    },
    {
        "id": 2,
        "name": "Divya",
        "gender": "female",
        "age": "70",
        "img": "data:image/jpeg;base64,UklGRi4cDABXRUJQVlA4ICIcDAAQIUudASqIEwIMPi0WiUOhoSEmIRE5WMAFiWlucBCG//70+TmP/+8aXfy76g6l/+/+L0DXIH/n//rqUq+/J+8/vtyK1n/Z+Zj0r/Lf/v/ieTf99+4Xk3+neiP/iv3G9sH/T7+70v/n9a7z0/9HlQeqH5qP/n6T37H0kvER97et//L/+nr8OM+0/+H///dIi6AAL4PFqI61S0O8tdmA3nElYTRvtcgYaU7KzOqj2VosklwhvUeJLqk6VYsbhD1VYIuP0ympa+3lygnfrcNFtv9E/j7ntzEKF4pZJ/WSYpVHzSkmRdH0fgCU0VHPPeg0EQolqQGQLJn7o9PdcUOiEbtBc75qyU",
        "generation": 0,
        "parents": [],
        "children": [],
        "spouses": [1],
        "siblings": [],
        "userId": null
    },
    {
        "id": 3,
        "name": "Ram Family",
        "gender": "male",
        "age": 26,
        "img": "http://localhost:3000/uploads/profile/FT-1751384262254-542823461.jpg",
        "generation": null,
        "parents": [],
        "children": [1],
        "spouses": [4],
        "siblings": [],
        "userId": 34
    },
    {
        "id": 4,
        "name": "ssss vvvv",
        "gender": "female",
        "age": 33,
        "img": "",
        "generation": null,
        "parents": [],
        "children": [1],
        "spouses": [3],
        "siblings": [],
        "userId": 36
    }
]

API Endpoints:

1. Create/Update Family Tree:
POST /family/tree/create
{
    "familyCode": "FAMILY123",
    "members": [
        // ... array of family members
    ]
}

2. Get Family Tree:
GET /family/tree/FAMILY123

How it works:

1. **For existing users (userId is provided):**
   - Only stores the userId in the family tree table
   - No additional user/profile creation needed

2. **For new users (userId is null):**
   - Creates a new user with temporary email and password
   - Creates a user profile with the provided information (including base64 image)
   - Adds user to family member table as approved member
   - Stores the new userId in the family tree table

3. **For existing family trees:**
   - Removes all existing family tree data for the family code
   - Creates new family tree data from scratch

4. **Profile Image Handling:**
   - If img is base64 encoded (starts with 'data:image/'): saves as file and stores filename
   - If img is already a URL: stores the URL as is
   - If no img: stores null

5. **The family tree table only stores:**
   - id (auto increment)
   - familyCode
   - userId (can be null for non-users)
   - generation
   - parents (JSON array)
   - children (JSON array)
   - spouses (JSON array)
   - siblings (JSON array)

This keeps the family tree data separate from user information while maintaining relationships.
*/ 