# Permission Control Stack - Design Document

## Problem

Provide dataset-level access control where authorization is determined by an employee hierarchy (Department > Team > Employee) combined with role-based permissions.

## Architecture Overview

```
                          ┌─────────────────┐
                          │  API Gateway     │
                          │  (REST API)      │
                          └────────┬─────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │               │
               ┌────▼───┐   ┌─────▼────┐   ┌─────▼─────┐
               │ Auth   │   │ Hierarchy│   │ Dataset   │
               │ Lambda │   │ Lambda   │   │ Lambda    │
               └────┬───┘   └─────┬────┘   └─────┬─────┘
                    │              │               │
                    └──────────────┼───────────────┘
                                   │
                          ┌────────▼─────────┐
                          │   DynamoDB       │
                          │   (3 tables)     │
                          └────────┬─────────┘
                                   │
                          ┌────────▼─────────┐
                          │   S3 Bucket      │
                          │   (Datasets)     │
                          └──────────────────┘
```

## Data Model (DynamoDB)

### Table 1: `EmployeeHierarchy`

Stores the org structure: Department > Team > Employee.

| Field          | Type   | Description                          |
|----------------|--------|--------------------------------------|
| PK             | String | `DEPT#<dept_id>` or `TEAM#<team_id>` |
| SK             | String | `TEAM#<team_id>` or `EMP#<emp_id>`   |
| entityType     | String | `department` / `team` / `employee`   |
| name           | String | Display name                         |
| parentId       | String | Parent entity ID                     |
| phone          | String | Employee phone (auth identifier)     |

**GSI1** — `phone-index`: PK=`phone` → look up employee by phone number.

### Table 2: `Roles`

Maps roles to dataset permissions.

| Field          | Type       | Description                       |
|----------------|------------|-----------------------------------|
| PK             | String     | `ROLE#<role_name>`                |
| SK             | String     | `ROLE#<role_name>`                |
| permissions    | StringSet  | e.g. `["dataset:read", "dataset:write"]` |
| datasets       | StringSet  | Allowed dataset IDs (or `["*"]`)  |

### Table 3: `RoleAssignments`

Links hierarchy nodes to roles. Roles can be assigned at any level (department, team, or employee) and inherit downward.

| Field          | Type   | Description                          |
|----------------|--------|--------------------------------------|
| PK             | String | `DEPT#<id>`, `TEAM#<id>`, or `EMP#<id>` |
| SK             | String | `ROLE#<role_name>`                   |
| assignedAt     | String | ISO timestamp                        |

## API Endpoints

### Auth

| Method | Path                  | Description                                |
|--------|-----------------------|--------------------------------------------|
| POST   | `/auth/verify`        | Verify employee by phone, return JWT token |

### Hierarchy Management

| Method | Path                          | Description                    |
|--------|-------------------------------|--------------------------------|
| GET    | `/hierarchy`                  | List departments               |
| POST   | `/hierarchy/departments`      | Create department              |
| POST   | `/hierarchy/teams`            | Create team under department   |
| POST   | `/hierarchy/employees`        | Create employee under team     |

### Role Management

| Method | Path                          | Description                    |
|--------|-------------------------------|--------------------------------|
| POST   | `/roles`                      | Create role with permissions   |
| POST   | `/roles/assign`               | Assign role to hierarchy node  |

### Dataset Access

| Method | Path                          | Description                    |
|--------|-------------------------------|--------------------------------|
| GET    | `/datasets`                   | List accessible datasets       |
| GET    | `/datasets/{id}`              | Get presigned S3 URL if authorized |
| PUT    | `/datasets/{id}`              | Upload dataset (if write role) |

## Authorization Flow

```
1. Employee authenticates via phone number
        │
2. Auth Lambda looks up employee in EmployeeHierarchy (GSI: phone-index)
        │
3. Returns JWT containing: { empId, teamId, deptId }
        │
4. Employee requests dataset access
        │
5. Dataset Lambda extracts JWT claims
        │
6. Queries RoleAssignments for all 3 levels:
   - EMP#<empId>
   - TEAM#<teamId>
   - DEPT#<deptId>
        │
7. Merges all roles → union of permissions & datasets
        │
8. If dataset is in allowed set and action is permitted → return presigned S3 URL
   Otherwise → 403 Forbidden
```

**Key design choice**: Roles assigned at a department level automatically apply to all teams and employees within it. This is achieved by querying all three hierarchy levels at authorization time (not by denormalizing).

## AWS Resources

| Resource        | Purpose                                         |
|-----------------|--------------------------------------------------|
| API Gateway     | REST API with Lambda proxy integration           |
| Lambda (Auth)   | Phone verification, JWT issuance                 |
| Lambda (Hierarchy) | CRUD for departments, teams, employees        |
| Lambda (Dataset)| Authorization check + S3 presigned URL generation |
| DynamoDB        | 3 tables for hierarchy, roles, role assignments  |
| S3 Bucket       | Dataset storage, private, no public access       |

## Security

- S3 bucket: block all public access; access only via presigned URLs generated by Dataset Lambda
- API Gateway: all `/datasets` and `/roles` endpoints require JWT (validated in Lambda)
- `/hierarchy` write endpoints require an admin role
- JWT secret stored in Lambda environment variable (or Secrets Manager for production)

## CDK Stack Structure

Single stack with all resources. Lambdas organized as:

```
lambda/
  auth/index.ts        — phone auth + JWT
  hierarchy/index.ts   — org structure CRUD
  dataset/index.ts     — authorization + S3 access
  shared/
    auth-util.ts       — JWT verify helper
    dynamo-util.ts     — common DynamoDB helpers
```

## Simplicity Decisions

1. **Single-table per concern** (not full single-table DynamoDB design) — easier to reason about
2. **No Cognito** — phone-based auth is simple JWT issuance, no need for a full identity provider
3. **Role inheritance by query-time resolution** — no fan-out writes when roles change
4. **Presigned URLs** — no need for CloudFront or custom S3 policies per user
5. **3 Lambdas** — one per domain (auth, hierarchy, dataset), not one per endpoint
