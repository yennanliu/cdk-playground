# Auth Stack 1

## ✅ **Updated System Design**

```
┌──────────────────────┐
│  HTML + JS UI (S3)   │  ◄── Lightweight static UI
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ API Gateway (JWT-sec)│  ◄── Validates JWT for each request
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│    Lambda (Node.js)  │  ◄── Business logic (auth, CRUD)
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ DynamoDB (User Table)│  ◄── Stores list of authorized members
└──────────────────────┘
```

---

## 🔐 **Auth Flow (Simple JWT)**

* A user provides a **pre-issued JWT token** (e.g., from an admin or login service).
* The token is:

  * Stored in `localStorage` or passed manually via the UI
  * Verified by **Lambda** using a **shared secret or public key**

---

## 📋 **API List (REST, JWT-secured)**

| **Method** | **Endpoint**        | **Description**                                |
| ---------- | ------------------- | ---------------------------------------------- |
| `POST`     | `/auth/verify`      | Validates the JWT and returns user info or 401 |
| `POST`     | `/members`          | Adds a new member to the authorization list    |
| `GET`      | `/members`          | Returns all current members                    |
| `DELETE`   | `/members/{userId}` | Removes a member from the list                 |
| `POST` | `/auth/login` | Authenticate user & return JWT token |


---

### 🔧 API Details

---

### `POST /auth/verify`

* **Purpose**: Validate provided JWT token
* **Headers**:

  * `Authorization: Bearer <token>`
* **Response**:

  * `200 OK` with `{ "userId": "...", "email": "...", "roles": [...] }`
  * `401 Unauthorized` if token invalid

---

### `POST /members`

* **Purpose**: Add a new authorized member
* **Headers**:

  * `Authorization: Bearer <token>`
* **Body**:

```json
{
  "email": "bob@example.com",
  "name": "Bob",
  "roles": ["viewer"]
}
```

* **Response**:

  * `201 Created`
  * `400 Bad Request` if missing fields
  * `403 Forbidden` if JWT lacks permission

---

### `GET /members`

* **Purpose**: List all authorized users
* **Headers**:

  * `Authorization: Bearer <token>`
* **Response**:

```json
[
  { "userId": "abc-123", "email": "admin@example.com", "roles": ["admin"] },
  { "userId": "def-456", "email": "bob@example.com", "roles": ["viewer"] }
]
```

---

### `DELETE /members/{userId}`

* **Purpose**: Remove a user from the authorized list
* **Headers**:

  * `Authorization: Bearer <token>`
* **Response**:

  * `204 No Content`
  * `404 Not Found` if user ID not found
  * `403 Forbidden` if JWT lacks permission

---

## 🖥️ **UI Plan (HTML + JS)**

| Page           | Feature                                                  |
| -------------- | -------------------------------------------------------- |
| `index.html`   | Login UI (paste token), and show admin panel if verified |
| `admin.html`   | Add member, list members, delete                         |
| JS (XHR/fetch) | Calls APIs with `Authorization: Bearer <token>` header   |

---
