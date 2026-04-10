# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A permission control system built with AWS CDK that implements dataset-level access control based on employee hierarchy (Department > Team > Employee) combined with role-based permissions. The system provides a REST API for authentication, hierarchy management, role management, and dataset access.

## Architecture

```
API Gateway (REST) → 3 Lambda Functions → DynamoDB (3 tables) + S3 bucket
```

**Components:**
- **API Gateway**: REST API with 4 resource paths (`/auth`, `/hierarchy`, `/roles`, `/datasets`)
- **3 Lambda Functions**: Auth (JWT issuance), Hierarchy (org structure CRUD), Dataset (authorization + S3 presigned URLs)
- **DynamoDB**: 3 tables (EmployeeHierarchy, Roles, RoleAssignments) with on-demand billing
- **S3 Bucket**: Private dataset storage, accessed via presigned URLs

**Key Design**: Roles assigned at department level inherit to teams and employees through query-time resolution (no fan-out writes). See `doc/design.md` for full authorization flow.

## Critical: Lambda Compilation

Lambda code lives in `lambda/` as TypeScript but must be compiled to JavaScript in `dist/lambda/` before deployment. The CDK stack references the compiled code, not the source.

**Compilation workflow:**
1. TypeScript Lambda source: `lambda/{auth,hierarchy,dataset}/index.ts`
2. Shared utilities: `lambda/shared/*.ts`
3. Compilation target: `dist/lambda/` (configured in `tsconfig.lambda.json`)
4. CDK references: `lib/permission-control-stack-stack.ts` points to `dist/lambda/`

**Important**: Always compile Lambda before deploying:
```bash
npm run build:lambda  # Compiles TypeScript to dist/lambda/
npm run build        # Compiles CDK TypeScript code
```

## Development Workflow

### Initial Setup
```bash
npm install
npm run build        # Compile CDK TypeScript
npm run build:lambda # Compile Lambda functions to dist/lambda/
```

### Common Commands

**Build & Watch:**
```bash
npm run build        # Compile CDK TypeScript code to lib/*.js
npm run watch        # Watch and recompile CDK code
npm run build:lambda # Compile Lambda functions to dist/lambda/
```

**Testing:**
```bash
npm test             # Run Jest unit tests
npm test -- <file>   # Run tests for specific file
npm test -- --watch  # Watch mode
```

**CDK Commands:**
```bash
cdk list             # List all stacks
cdk synth            # Synthesize CloudFormation template
cdk diff             # Show differences vs deployed stack
cdk deploy           # Deploy stack to AWS
cdk destroy          # Destroy stack
```

**Cleanup:**
```bash
npm run clean        # Remove compiled JS from lib/ and bin/
npm run clean:all    # Also removes node_modules and cdk.out
```

## File Organization

```
bin/
  permission-control-stack.ts     # CDK app entry point
lib/
  permission-control-stack-stack.ts  # Main stack definition (3 tables, 3 Lambdas, API Gateway)
lambda/
  auth/
    index.ts                       # Phone-based auth, JWT issuance
  hierarchy/
    index.ts                       # CRUD for departments, teams, employees
  dataset/
    index.ts                       # Authorization checks, presigned S3 URL generation
  shared/
    auth-util.ts                   # JWT verification helper
    dynamo-util.ts                 # DynamoDB query helpers
test/
  permission-control-stack.test.ts # Jest tests (snapshot tests recommended)
doc/
  design.md                        # Full architecture and authorization flow
```

## Development Guidelines

### Lambda Development

1. **Edit TypeScript source** in `lambda/*/index.ts`
2. **Compile** with `npm run build:lambda`
3. **Test locally** using AWS SAM or invoke directly if needed
4. **Deploy** via `cdk deploy` (CDK orchestrates everything)

Environment variables are injected by CDK (see `lib/permission-control-stack-stack.ts`):
- `HIERARCHY_TABLE`, `ROLE_TABLE`, `ROLE_ASSIGNMENT_TABLE`, `DATASET_BUCKET`
- `JWT_SECRET` (currently hardcoded as placeholder — **change for production**)

### Stack Development

The single stack (`PermissionControlStackStack`) defines:
- 3 DynamoDB tables with PAY_PER_REQUEST billing
- 3 Lambda functions with appropriate IAM grants
- S3 bucket with public access blocked
- API Gateway REST API with resource hierarchy

### Testing

Current test file has outdated assertions (references SQS/SNS which don't exist). Recommended approach:
- Use snapshot tests to verify CloudFormation template structure
- Mock DynamoDB and S3 for Lambda unit tests
- Integration tests against real AWS resources (use sparingly due to cost)

## Important Notes

### JWT Secret
The `JWT_SECRET` environment variable is hardcoded as `'change-me-use-secrets-manager'` in the stack. For production, store in AWS Secrets Manager and retrieve in Lambda code.

### DynamoDB Design
Uses 3 separate tables (not single-table design) for clarity:
- **EmployeeHierarchy**: Stores org structure with `phone-index` GSI for employee lookup
- **Roles**: Maps role names to permissions and allowed datasets
- **RoleAssignments**: Links hierarchy nodes to roles (supports inheritance by query resolution)

All tables use `RemovalPolicy.DESTROY` for development convenience. Change to `RETAIN` or `SNAPSHOT` for production.

### Authorization Flow
1. Employee authenticates via phone → Auth Lambda issues JWT with `empId`, `teamId`, `deptId`
2. Dataset access request includes JWT
3. Dataset Lambda checks `RoleAssignments` at all 3 levels (department, team, employee)
4. Merges roles and permissions → returns presigned S3 URL or 403 Forbidden

## Troubleshooting

**Lambda not updating after code changes:**
- Verify `npm run build:lambda` compiled to `dist/lambda/`
- Check `cdk.json` for Lambda handler paths
- Redeploy with `cdk deploy` (hotswap may not work for code changes in all cases)

**DynamoDB capacity issues:**
- All tables use on-demand billing (PAY_PER_REQUEST) — no capacity units to configure
- Monitor CloudWatch for throttling if access patterns change significantly

**TypeScript compilation errors:**
- Check `tsconfig.json` (CDK code) vs `tsconfig.lambda.json` (Lambda code) — they have different configurations
- Lambda code compiles to `dist/lambda/`, CDK code stays in `lib/` and `bin/`
