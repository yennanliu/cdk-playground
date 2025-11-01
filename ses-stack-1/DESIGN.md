# Enterprise Email System with AWS SES - Design Document

**Document Version:** 1.0
**Date:** 2025-11-01
**Author:** System Architecture Team
**Status:** Draft for Review

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [Requirements](#requirements)
4. [Architecture Options](#architecture-options)
5. [Recommended Architecture](#recommended-architecture)
6. [Component Design](#component-design)
7. [Data Models](#data-models)
8. [API Specifications](#api-specifications)
9. [Event Flow](#event-flow)
10. [Security & Compliance](#security--compliance)
11. [Monitoring & Operations](#monitoring--operations)
12. [Scalability & Performance](#scalability--performance)
13. [Cost Estimation](#cost-estimation)
14. [Implementation Roadmap](#implementation-roadmap)
15. [Open Questions](#open-questions)

---

## Executive Summary

This document outlines the design for an enterprise-grade email system built on AWS Simple Email Service (SES). The system provides:

- **Reliable email delivery** for transactional and notification emails
- **Real-time status tracking** with comprehensive event monitoring
- **Backend integration** via webhooks, APIs, or message queues
- **Scalable architecture** handling variable email volumes
- **Audit trail** with full email lifecycle tracking

The recommended architecture uses an event-driven pattern with SNS, Lambda, and DynamoDB to provide a robust, scalable solution that meets enterprise requirements.

---

## System Overview

### Goals

1. **Send emails** reliably through AWS SES
2. **Track email lifecycle** (sent, delivered, bounced, complained, opened, clicked)
3. **Notify backend applications** of status changes in real-time
4. **Provide audit trail** for compliance and debugging
5. **Handle failures gracefully** with retry logic and dead-letter queues
6. **Scale automatically** based on email volume

### Non-Goals

- Email template design and management (can be added later)
- Marketing automation features (drip campaigns, A/B testing)
- Email client/webmail interface
- SMTP relay service

---

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Send transactional emails via API | Must Have |
| FR-2 | Track email delivery status (sent, delivered, bounced, complained) | Must Have |
| FR-3 | Notify backend app when email status changes | Must Have |
| FR-4 | Store email metadata and event history | Must Have |
| FR-5 | Support email attachments | Should Have |
| FR-6 | Handle rate limiting and retries | Must Have |
| FR-7 | Support email templates | Should Have |
| FR-8 | Track email opens and link clicks | Nice to Have |
| FR-9 | Support scheduled email sending | Nice to Have |
| FR-10 | Manage suppression lists (bounces, complaints) | Should Have |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Availability | 99.9% uptime |
| NFR-2 | Email send latency | < 2 seconds (p95) |
| NFR-3 | Status update latency | < 5 seconds (p95) |
| NFR-4 | Throughput | 1000+ emails/minute |
| NFR-5 | Data retention | 90 days minimum |
| NFR-6 | Notification delivery | 99.5% success rate |

---

## Architecture Options

### Option 1: Event-Driven with SNS + Lambda (Recommended)

```
┌─────────────┐
│ Backend App │──(1. Send Email Request)──┐
└─────────────┘                           │
       ↑                                  ↓
       │                        ┌──────────────────┐
       │                        │   API Gateway    │
       │                        │        +         │
       │                        │  Lambda (Sender) │
       │                        └──────────────────┘
       │                                  │
       │                                  ↓
       │                        ┌──────────────────┐
       │                        │    Amazon SES    │
       │                        │  (w/ Config Set) │
       │                        └──────────────────┘
       │                                  │
       │                    ┌─────────────┼─────────────┐
       │                    ↓             ↓             ↓
       │            [Delivery]      [Bounce]      [Complaint]
       │                    │             │             │
       │                    └─────────────┴─────────────┘
       │                                  │
       │                                  ↓
       │                        ┌──────────────────┐
       │                        │    SNS Topics    │
       │                        └──────────────────┘
       │                                  │
       │                                  ↓
       │                   ┌──────────────────────────┐
       │                   │ Lambda (Event Processor) │
       │                   └──────────────────────────┘
       │                          │              │
       │                          ↓              ↓
       │                   ┌──────────┐   ┌───────────┐
       └───(Webhook/API)───│ DynamoDB │   │ Backend   │
                           │ (Status) │   │ Webhook   │
                           └──────────┘   └───────────┘
```

**Pros:**
- Real-time event processing
- Native AWS service integration
- Simple to implement and maintain
- Cost-effective for most use cases
- Built-in retry and error handling

**Cons:**
- SNS fan-out limits (100,000 subscriptions)
- Limited event filtering capabilities
- Requires separate topics per event type

### Option 2: EventBridge-Based

```
┌─────────────┐
│ Backend App │──→ API Gateway ──→ Lambda Sender ──→ Amazon SES
└─────────────┘                                           │
       ↑                                                  ↓
       │                                        EventBridge Event Bus
       │                                                  │
       │                              ┌───────────────────┼──────────────┐
       │                              ↓                   ↓              ↓
       │                      Lambda Processor    Backend Webhook   CloudWatch
       │                              ↓
       │                         DynamoDB
       └──────────────────────────────┘
```

**Pros:**
- Advanced event filtering and routing
- Multiple consumers without fan-out limits
- Schema registry for event validation
- Better for complex event-driven architectures
- Cross-account event sharing

**Cons:**
- Higher latency (slight)
- More complex setup
- Higher cost per event
- Requires SES event publishing via SNS → EventBridge

### Option 3: Queue-Based (High Volume)

```
┌─────────────┐
│ Backend App │──→ API Gateway ──→ SQS Queue ──→ Lambda Sender ──→ SES
└─────────────┘                                                      │
       ↑                                                             ↓
       │                                                      SNS Topics
       │                                                             │
       │                                                             ↓
       │                                              Lambda Event Processor
       │                                                      │      │
       │                                                      ↓      ↓
       └─────────────────────────────────────────────── DynamoDB  Backend
```

**Pros:**
- Built-in rate limiting and throttling
- Excellent for high-volume scenarios
- Better decoupling of components
- Dead-letter queue for failed messages
- Batch processing support

**Cons:**
- Higher latency for immediate sends
- Additional queue management overhead
- More complex error handling
- Requires polling or Lambda triggers

---

## Recommended Architecture

**Option 1: Event-Driven with SNS + Lambda** is recommended for the following reasons:

1. **Simplicity**: Straightforward architecture with fewer moving parts
2. **Real-time**: Low latency for both sending and status updates
3. **Cost-effective**: Pay only for actual usage with minimal overhead
4. **Maintainability**: Standard AWS patterns, easy to debug and monitor
5. **Scalability**: Handles typical enterprise volumes (10K-1M emails/day)

### Architecture Diagram (Detailed)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Backend Application                         │
│  ┌────────────────┐                              ┌────────────────┐ │
│  │ Email Service  │                              │ Webhook Handler│ │
│  └────────┬───────┘                              └────────▲───────┘ │
│           │                                               │         │
└───────────┼───────────────────────────────────────────────┼─────────┘
            │ (1) POST /send-email                          │
            │                                               │ (6) Status Update
            ↓                                               │
┌─────────────────────────────────────────────────────────────────────┐
│                          AWS Cloud                                   │
│                                                                      │
│  ┌────────────────────────────────────────────────────────┐         │
│  │                    API Gateway (REST)                  │         │
│  │  /send-email, /status/{emailId}, /suppression-list    │         │
│  └───────────────────────┬────────────────────────────────┘         │
│                          │                                           │
│                          ↓ (2) Invoke                                │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              Lambda: EmailSender                            │    │
│  │  - Validate request                                         │    │
│  │  - Generate emailId                                         │    │
│  │  - Save to DynamoDB (status: 'pending')                    │    │
│  │  - Call SES sendEmail()                                     │    │
│  │  - Update DynamoDB (status: 'sent', messageId)            │    │
│  │  - Return response                                          │    │
│  └───────────────────────┬─────────────────────────────────────┘    │
│                          │                                           │
│                          ↓ (3) Send Email                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Amazon SES                               │    │
│  │  ┌──────────────────────────────────────────────────────┐  │    │
│  │  │         Configuration Set: "enterprise-email"        │  │    │
│  │  │  - Event Destinations: SNS                           │  │    │
│  │  │  - Custom Headers: X-Email-Id                        │  │    │
│  │  └──────────────────────────────────────────────────────┘  │    │
│  │                                                             │    │
│  │  Domain Identity: example.com (DKIM verified)              │    │
│  └───────────────────────┬─────────────────────────────────────┘    │
│                          │                                           │
│                          ↓ (4) Publish Events                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   SNS Topics                                │    │
│  │  - ses-delivery-topic                                       │    │
│  │  - ses-bounce-topic                                         │    │
│  │  - ses-complaint-topic                                      │    │
│  │  - ses-send-topic                                           │    │
│  └───────────────────────┬─────────────────────────────────────┘    │
│                          │                                           │
│                          ↓ (5) Trigger                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │           Lambda: EventProcessor                            │    │
│  │  - Parse SNS message                                        │    │
│  │  - Extract emailId from headers                             │    │
│  │  - Update DynamoDB:                                         │    │
│  │    * status field                                           │    │
│  │    * events array (append event)                            │    │
│  │    * lastUpdated timestamp                                  │    │
│  │  - Call backend webhook (async)                             │    │
│  │  - Handle suppression list updates                          │    │
│  └──────────────────────┬──┬───────────────────────────────────┘    │
│                         │  │                                         │
│                         │  └──────┐                                  │
│                         ↓         ↓                                  │
│  ┌─────────────────────────┐  ┌──────────────────────────────┐      │
│  │      DynamoDB Tables    │  │    Secrets Manager           │      │
│  │  ┌──────────────────┐   │  │  - Backend webhook URL       │      │
│  │  │  EmailTracking   │   │  │  - Webhook API key           │      │
│  │  │  (emailId: PK)   │   │  │  - SES credentials (if IAM)  │      │
│  │  └──────────────────┘   │  └──────────────────────────────┘      │
│  │  ┌──────────────────┐   │                                         │
│  │  │  SuppressionList │   │  ┌──────────────────────────────┐      │
│  │  │  (email: PK)     │   │  │    CloudWatch Logs           │      │
│  │  └──────────────────┘   │  │  - Lambda logs               │      │
│  └─────────────────────────┘  │  - SES sending metrics       │      │
│                                │  - Error logs                │      │
│  ┌─────────────────────────┐  └──────────────────────────────┘      │
│  │    SQS Dead Letter      │                                         │
│  │    Queue (DLQ)          │  ┌──────────────────────────────┐      │
│  │  - Failed webhooks      │  │    X-Ray Tracing             │      │
│  │  - Processing errors    │  │  - End-to-end tracing        │      │
│  └─────────────────────────┘  └──────────────────────────────┘      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Component Design

### 1. API Gateway

**Endpoints:**

```
POST   /send-email          # Send a new email
GET    /status/{emailId}    # Get email status and history
GET    /emails              # List emails (with filters)
POST   /suppression/add     # Add email to suppression list
DELETE /suppression/{email} # Remove from suppression list
GET    /suppression         # List suppressed emails
```

**Features:**
- API key authentication
- Request validation
- Rate limiting (1000 req/sec)
- CORS configuration
- CloudWatch logging

### 2. Lambda: EmailSender

**Runtime:** Node.js 20.x or Python 3.12
**Memory:** 512 MB
**Timeout:** 30 seconds

**Responsibilities:**
1. Validate request payload
2. Generate unique `emailId` (UUID)
3. Store initial record in DynamoDB
4. Call SES `sendEmail` API with configuration set
5. Update DynamoDB with SES `messageId`
6. Return response to API Gateway

**Input Schema:**
```json
{
  "to": ["user@example.com"],
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"],
  "subject": "Email subject",
  "bodyText": "Plain text body",
  "bodyHtml": "<html>HTML body</html>",
  "from": "noreply@example.com",
  "replyTo": ["support@example.com"],
  "attachments": [
    {
      "filename": "document.pdf",
      "contentType": "application/pdf",
      "content": "base64-encoded-data"
    }
  ],
  "metadata": {
    "userId": "user-123",
    "transactionId": "txn-456"
  },
  "tags": {
    "campaign": "welcome-email",
    "type": "transactional"
  }
}
```

**Output Schema:**
```json
{
  "success": true,
  "emailId": "550e8400-e29b-41d4-a716-446655440000",
  "messageId": "<ses-message-id@email.amazonses.com>",
  "status": "sent",
  "sentAt": "2025-11-01T10:00:00.000Z"
}
```

**Error Handling:**
- Validate all required fields
- Check suppression list before sending
- Handle SES throttling with exponential backoff
- Return appropriate HTTP status codes

### 3. Lambda: EventProcessor

**Runtime:** Node.js 20.x or Python 3.12
**Memory:** 256 MB
**Timeout:** 60 seconds
**Concurrency:** Reserved capacity of 100

**Responsibilities:**
1. Parse SNS notification
2. Extract `emailId` from SES event
3. Update DynamoDB with new status and event details
4. Call backend webhook with retry logic
5. Update suppression list if needed
6. Send to DLQ on permanent failure

**SES Event Types Handled:**
- **Send**: Email accepted by SES
- **Delivery**: Successfully delivered to recipient
- **Bounce**: Delivery failed (hard or soft)
- **Complaint**: Recipient marked as spam
- **Reject**: SES rejected (invalid, suppressed)
- **Open**: Recipient opened email (if tracking enabled)
- **Click**: Recipient clicked link (if tracking enabled)

**Webhook Payload:**
```json
{
  "emailId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "delivery",
  "timestamp": "2025-11-01T10:00:05.000Z",
  "recipient": "user@example.com",
  "details": {
    "smtpResponse": "250 2.0.0 OK",
    "reportingMTA": "a8-50.smtp-out.amazonses.com",
    "processingTimeMillis": 428
  },
  "metadata": {
    "userId": "user-123",
    "transactionId": "txn-456"
  }
}
```

**Retry Logic:**
- Exponential backoff: 1s, 2s, 4s, 8s, 16s
- Maximum 5 retries
- Failed attempts go to DLQ
- Alert on DLQ depth threshold

### 4. DynamoDB Tables

#### EmailTracking Table

**Purpose:** Store email metadata and lifecycle events

```typescript
{
  // Partition Key
  emailId: string;                    // UUID

  // Attributes
  recipient: string;                  // Primary recipient (GSI)
  cc: string[];
  bcc: string[];
  subject: string;
  from: string;
  replyTo: string[];

  // Status tracking
  status: "pending" | "sent" | "delivered" | "bounced" | "complained";
  messageId: string;                  // SES message ID

  // Timestamps
  createdAt: number;                  // Unix timestamp (GSI)
  sentAt: number;
  lastUpdated: number;

  // Events history
  events: [
    {
      type: "sent" | "delivery" | "bounce" | "complaint",
      timestamp: number,
      details: object
    }
  ],

  // Custom data
  metadata: object;                   // Customer's metadata
  tags: object;                       // Customer's tags

  // TTL for auto-deletion
  ttl: number;                        // Expire after 90 days
}
```

**Indexes:**
- **GSI-1:** `recipient` (PK) + `createdAt` (SK) - Query emails by recipient
- **GSI-2:** `status` (PK) + `createdAt` (SK) - Query by status
- **GSI-3:** `messageId` (PK) - Lookup by SES message ID

**Capacity:**
- On-Demand billing mode (auto-scaling)
- Point-in-time recovery enabled
- Encryption at rest enabled

#### SuppressionList Table

**Purpose:** Maintain list of emails that should not receive emails

```typescript
{
  // Partition Key
  email: string;                      // Email address

  // Attributes
  reason: "bounce" | "complaint" | "manual";
  addedAt: number;
  lastAttemptAt: number;
  attemptCount: number;

  // Bounce details
  bounceType: "Permanent" | "Transient" | "Undetermined";
  bounceSubType: string;

  // TTL for temporary suppressions
  ttl: number;                        // Expire soft bounces after 7 days
}
```

### 5. SES Configuration

#### Domain Identity
- Domain: `example.com`
- DKIM signing enabled
- MAIL FROM domain: `mail.example.com`
- SPF record: `v=spf1 include:amazonses.com ~all`
- DMARC policy: `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com`

#### Configuration Set
- Name: `enterprise-email`
- Reputation metrics enabled
- Sending enabled from verified identities only

#### Event Destinations
| Event Type | Destination | SNS Topic |
|------------|-------------|-----------|
| Send | SNS | ses-send-topic |
| Delivery | SNS | ses-delivery-topic |
| Bounce | SNS | ses-bounce-topic |
| Complaint | SNS | ses-complaint-topic |
| Reject | SNS | ses-reject-topic |

#### Custom Headers
- `X-Email-Id`: Unique email ID for tracking
- `X-Metadata`: Base64-encoded metadata JSON

---

## Data Models

### Email Status State Machine

```
  [pending]
      │
      ↓ SES accepts email
   [sent]
      │
      ├──→ [delivered]  (success)
      │
      ├──→ [bounced]    (failure)
      │     ├─ Permanent (hard bounce)
      │     └─ Transient (soft bounce)
      │
      └──→ [complained] (marked as spam)
```

### Event Flow Diagram

```
Time ──────────────────────────────────────────────────────────>

  0s          1s         2s         3s         4s         5s
  │           │          │          │          │          │
  ├─ API      │          │          │          │          │
  │  Request  │          │          │          │          │
  │           │          │          │          │          │
  ├─ Lambda   │          │          │          │          │
  │  Sender   │          │          │          │          │
  │           │          │          │          │          │
  └─ DynamoDB │          │          │          │          │
     Insert   │          │          │          │          │
              │          │          │          │          │
              ├─ SES     │          │          │          │
              │  Send    │          │          │          │
              │          │          │          │          │
              └─ DynamoDB│          │          │          │
                 Update  │          │          │          │
                         │          │          │          │
                         ├─ API     │          │          │
                         │  Response│          │          │
                         │          │          │          │
                         │          ├─ SNS     │          │
                         │          │  Event   │          │
                         │          │          │          │
                         │          ├─ Lambda  │          │
                         │          │  Event   │          │
                         │          │  Proc.   │          │
                         │          │          │          │
                         │          └─ DynamoDB│          │
                         │             Update  │          │
                         │                     │          │
                         │                     ├─ Webhook│
                         │                     │  Call   │
                         │                     │         │
                         │                     └─ Backend│
                         │                        Notif. │
```

---

## API Specifications

### POST /send-email

**Request:**
```http
POST /send-email HTTP/1.1
Host: api.example.com
Content-Type: application/json
X-API-Key: your-api-key

{
  "to": ["recipient@example.com"],
  "subject": "Welcome to our service",
  "bodyHtml": "<html><body>Welcome!</body></html>",
  "bodyText": "Welcome!",
  "from": "noreply@example.com",
  "metadata": {
    "userId": "12345"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "emailId": "550e8400-e29b-41d4-a716-446655440000",
  "messageId": "<0100018c7e8a1234-abcd1234@email.amazonses.com>",
  "status": "sent",
  "sentAt": "2025-11-01T10:00:00.000Z"
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "Missing required field: subject",
  "details": {
    "field": "subject",
    "constraint": "required"
  }
}
```

**Response (429 Too Many Requests):**
```json
{
  "success": false,
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded. Please retry after 60 seconds.",
  "retryAfter": 60
}
```

### GET /status/{emailId}

**Request:**
```http
GET /status/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Host: api.example.com
X-API-Key: your-api-key
```

**Response (200 OK):**
```json
{
  "emailId": "550e8400-e29b-41d4-a716-446655440000",
  "recipient": "user@example.com",
  "subject": "Welcome to our service",
  "status": "delivered",
  "messageId": "<0100018c7e8a1234@email.amazonses.com>",
  "createdAt": "2025-11-01T10:00:00.000Z",
  "sentAt": "2025-11-01T10:00:01.000Z",
  "lastUpdated": "2025-11-01T10:00:05.000Z",
  "events": [
    {
      "type": "sent",
      "timestamp": "2025-11-01T10:00:01.000Z",
      "details": {}
    },
    {
      "type": "delivery",
      "timestamp": "2025-11-01T10:00:05.000Z",
      "details": {
        "smtpResponse": "250 2.0.0 OK",
        "reportingMTA": "a8-50.smtp-out.amazonses.com",
        "processingTimeMillis": 428
      }
    }
  ],
  "metadata": {
    "userId": "12345"
  }
}
```

---

## Event Flow

### 1. Send Email Flow

```
┌────────┐     ┌────────────┐     ┌─────────┐     ┌──────────┐     ┌─────┐
│Backend │────>│API Gateway │────>│ Lambda  │────>│ DynamoDB │────>│ SES │
│  App   │     │            │     │ Sender  │     │          │     │     │
└────────┘     └────────────┘     └─────────┘     └──────────┘     └─────┘
   (1)             (2)                (3)              (4)            (5)
   │               │                  │                │              │
   │ POST          │                  │                │              │
   │ /send-email   │                  │                │              │
   │               │                  │                │              │
   │               │ Invoke Lambda    │                │              │
   │               │─────────────────>│                │              │
   │               │                  │                │              │
   │               │                  │ Insert Record  │              │
   │               │                  │───────────────>│              │
   │               │                  │                │              │
   │               │                  │ Send Email     │              │
   │               │                  │───────────────────────────────>│
   │               │                  │                │              │
   │               │                  │<───────────────────────────────│
   │               │                  │ MessageId      │              │
   │               │                  │                │              │
   │               │                  │ Update Record  │              │
   │               │                  │───────────────>│              │
   │               │                  │                │              │
   │               │<─────────────────│                │              │
   │               │ Response         │                │              │
   │               │                  │                │              │
   │<──────────────│                  │                │              │
   │ Email ID      │                  │                │              │
   │               │                  │                │              │
```

### 2. Event Processing Flow

```
┌─────┐     ┌─────┐     ┌─────────┐     ┌──────────┐     ┌────────┐
│ SES │────>│ SNS │────>│ Lambda  │────>│ DynamoDB │────>│Backend │
│     │     │     │     │  Event  │     │          │     │  App   │
└─────┘     └─────┘     │Processor│     └──────────┘     └────────┘
   │          │          └─────────┘          │              │
   │ Event    │               │               │              │
   │ (Delivery)│               │               │              │
   │──────────>│               │               │              │
   │          │               │               │              │
   │          │ Trigger       │               │              │
   │          │──────────────>│               │              │
   │          │               │               │              │
   │          │               │ Parse Event   │              │
   │          │               │ Extract ID    │              │
   │          │               │               │              │
   │          │               │ Update Status │              │
   │          │               │──────────────>│              │
   │          │               │               │              │
   │          │               │ Call Webhook  │              │
   │          │               │──────────────────────────────>│
   │          │               │               │              │
   │          │               │<──────────────────────────────│
   │          │               │ Ack           │              │
```

---

## Security & Compliance

### Authentication & Authorization

1. **API Gateway**
   - API Key for client authentication
   - IAM authorization for AWS services
   - Resource policies to restrict access

2. **Lambda Functions**
   - Least privilege IAM roles
   - VPC access (if needed for private resources)
   - Environment variables encrypted with KMS

3. **Backend Webhook**
   - HMAC signature verification
   - API key in Secrets Manager
   - TLS 1.2+ required

### Data Protection

1. **Encryption at Rest**
   - DynamoDB: AWS managed encryption
   - SQS: KMS encryption
   - Secrets Manager: KMS encryption
   - CloudWatch Logs: KMS encryption

2. **Encryption in Transit**
   - TLS 1.2+ for all API calls
   - SES uses TLS when available
   - VPC endpoints for AWS service communication

3. **Data Retention**
   - Email tracking: 90 days (DynamoDB TTL)
   - CloudWatch Logs: 30 days
   - Suppression list: Indefinite (until manually removed)

### Compliance Considerations

1. **GDPR**
   - Right to erasure: API to delete email records
   - Data minimization: Only store necessary fields
   - Consent tracking in metadata

2. **CAN-SPAM**
   - Unsubscribe link in emails
   - Suppression list management
   - Accurate "From" addresses

3. **SOC 2**
   - Audit logging (CloudTrail)
   - Access controls (IAM)
   - Monitoring and alerting

### Security Best Practices

- [ ] Enable AWS Config for compliance monitoring
- [ ] Set up AWS GuardDuty for threat detection
- [ ] Implement AWS WAF rules on API Gateway
- [ ] Enable VPC Flow Logs
- [ ] Use AWS Systems Manager Parameter Store for config
- [ ] Rotate API keys regularly
- [ ] Implement rate limiting and throttling
- [ ] Set up CloudWatch alarms for anomalies
- [ ] Regular security audits and penetration testing
- [ ] Implement IP whitelisting if applicable

---

## Monitoring & Operations

### CloudWatch Dashboards

#### Email Operations Dashboard

**Metrics:**
- Emails sent per minute
- SES send rate (current vs quota)
- Average send latency (p50, p95, p99)
- API Gateway request count and latency
- Lambda invocation count and duration
- Lambda error rate and throttles

**Widgets:**
- Line graph: Email volume over time
- Pie chart: Email status distribution
- Number: Current send rate
- Table: Recent errors

#### Email Delivery Dashboard

**Metrics:**
- Delivery rate (%)
- Bounce rate (%) by type (hard, soft)
- Complaint rate (%)
- Average time to delivery
- Event processing latency

**Alarms:**
- Bounce rate > 5%
- Complaint rate > 0.1%
- Delivery rate < 95%
- Event processing delay > 30 seconds

### CloudWatch Alarms

| Alarm Name | Metric | Threshold | Action |
|------------|--------|-----------|--------|
| HighBounceRate | Bounce Rate | > 5% | SNS → On-Call |
| HighComplaintRate | Complaint Rate | > 0.1% | SNS → Email Team |
| LowDeliveryRate | Delivery Rate | < 95% | SNS → On-Call |
| LambdaErrors | Error Count | > 10 in 5 min | SNS → Dev Team |
| DLQDepth | Queue Depth | > 100 | SNS → Dev Team |
| SESQuotaUsage | Send Quota % | > 80% | SNS → Ops Team |
| APILatency | p95 Latency | > 2000ms | SNS → Dev Team |
| ThrottledRequests | Throttle Count | > 50 in 5 min | SNS → Ops Team |

### Logging Strategy

1. **Structured Logging**
   ```json
   {
     "timestamp": "2025-11-01T10:00:00.000Z",
     "level": "INFO",
     "service": "email-sender",
     "emailId": "550e8400-e29b-41d4-a716-446655440000",
     "event": "email_sent",
     "messageId": "<ses-message-id>",
     "recipient": "user@example.com",
     "duration_ms": 245
   }
   ```

2. **Log Levels**
   - ERROR: Failed operations, exceptions
   - WARN: Retries, throttling, soft bounces
   - INFO: Successful operations, state changes
   - DEBUG: Detailed request/response data (dev only)

3. **CloudWatch Insights Queries**
   ```sql
   # Top 10 email recipients
   fields recipient, count(*) as email_count
   | filter event = "email_sent"
   | stats count(*) by recipient
   | sort email_count desc
   | limit 10

   # Error analysis
   fields @timestamp, level, message, emailId
   | filter level = "ERROR"
   | sort @timestamp desc

   # Latency analysis
   fields @timestamp, duration_ms
   | filter event = "email_sent"
   | stats avg(duration_ms), max(duration_ms), pct(duration_ms, 95)
   ```

### X-Ray Tracing

**Trace Segments:**
1. API Gateway request
2. Lambda execution
3. DynamoDB operations
4. SES API call
5. SNS notification
6. Backend webhook call

**Custom Annotations:**
- emailId
- recipient
- status
- error_type

### Operational Runbooks

#### High Bounce Rate
1. Check SES reputation dashboard
2. Review recent email content for spam triggers
3. Analyze bounced email domains
4. Verify DNS records (SPF, DKIM, DMARC)
5. Consider sending volume reduction
6. Contact AWS Support if needed

#### DLQ Growth
1. Inspect messages in DLQ
2. Identify common failure patterns
3. Check backend webhook availability
4. Review Lambda error logs
5. Fix root cause and replay messages
6. Update retry logic if needed

#### SES Quota Exceeded
1. Check current send rate
2. Review email volume trends
3. Request quota increase via AWS Support
4. Implement email queuing/batching
5. Consider email priority system

---

## Scalability & Performance

### Capacity Planning

#### SES Limits (Default)
- **Sending Quota**: 50,000 emails/24 hours (increasable)
- **Send Rate**: 14 emails/second (increasable)
- **Maximum Message Size**: 10 MB (with attachments)

#### Lambda Limits
- **Concurrent Executions**: 1,000 (account-level, increasable)
- **EmailSender**: Estimated 10ms per email → 100 emails/second per instance
- **EventProcessor**: Estimated 50ms per event → 20 events/second per instance

#### DynamoDB Capacity
- **On-Demand Mode**: Auto-scales to workload
- **Expected RCU**: ~5 RCU per email (read status)
- **Expected WCU**: ~3 WCU per email (insert + 2 updates avg)

### Performance Optimization

1. **Batch Operations**
   - SES: Use `sendBulkEmail` for similar emails
   - DynamoDB: Use `batchWriteItem` for multiple updates
   - SNS: Fan-out pattern for parallel processing

2. **Caching**
   - Cache suppression list in Lambda memory (5-minute TTL)
   - Cache SES templates in Lambda
   - Use API Gateway caching for GET /status (60-second TTL)

3. **Parallel Processing**
   - Process SNS events in parallel (Lambda concurrency)
   - Async webhook calls with SQS buffering
   - Concurrent DynamoDB operations

4. **Connection Pooling**
   - Reuse AWS SDK clients across invocations
   - Keep-alive for HTTP connections
   - Database connection pooling (if using RDS for analytics)

### Scaling Scenarios

#### Scenario 1: Steady Load (1,000 emails/hour)
- API Gateway: ~0.28 req/sec (well within limits)
- Lambda EmailSender: 1-2 concurrent executions
- Lambda EventProcessor: 2-3 concurrent executions
- DynamoDB: ~1 WCU, ~1 RCU sustained
- **Cost**: ~$5-10/month

#### Scenario 2: Peak Load (10,000 emails/hour)
- API Gateway: ~2.78 req/sec
- Lambda EmailSender: 10-20 concurrent executions
- Lambda EventProcessor: 20-30 concurrent executions
- DynamoDB: ~10 WCU, ~5 RCU sustained
- **Cost**: ~$50-100/month

#### Scenario 3: High Volume (100,000 emails/hour)
- API Gateway: ~27.78 req/sec
- Lambda EmailSender: 100-200 concurrent executions
- Lambda EventProcessor: 200-300 concurrent executions
- DynamoDB: ~100 WCU, ~50 RCU sustained
- Requires SQS buffering to prevent SES rate limit
- **Cost**: ~$500-1000/month

---

## Cost Estimation

### Monthly Cost Breakdown (10,000 emails/day)

| Service | Usage | Unit Cost | Monthly Cost |
|---------|-------|-----------|--------------|
| **API Gateway** | 300K requests | $3.50/million | $1.05 |
| **Lambda** | 600K invocations<br>256MB, 100ms avg | $0.20/million<br>$0.0000166667/GB-sec | $0.12<br>$2.56 |
| **SES** | 300K emails | $0.10/1000 | $30.00 |
| **SNS** | 900K notifications | $0.50/million | $0.45 |
| **DynamoDB** | On-Demand<br>~1M WCU, ~500K RCU | $1.25/million WCU<br>$0.25/million RCU | $1.25<br>$0.13 |
| **CloudWatch Logs** | 5 GB ingested<br>30-day retention | $0.50/GB | $2.50 |
| **Data Transfer** | 1 GB out | $0.09/GB | $0.09 |
| **Secrets Manager** | 2 secrets | $0.40/secret/month | $0.80 |
| **SQS (DLQ)** | 10K requests | $0.40/million | $0.004 |
| **X-Ray** | 600K traces | $5.00/million | $3.00 |
| | | **Total** | **~$42/month** |

### Cost Optimization Strategies

1. **Reduce Lambda memory**: Profile and right-size (256MB → 128MB)
2. **CloudWatch Logs**: Use log filtering, reduce retention to 7 days
3. **DynamoDB**: Use on-demand only; consider provisioned for predictable load
4. **API Gateway**: Use HTTP API instead of REST API (-70% cost)
5. **X-Ray**: Sample traces (10% instead of 100%)
6. **S3 archival**: Move old email data to S3 Glacier for long-term storage

### Scaling Cost Impact

- **10x volume** (100K emails/day): ~$350/month
- **100x volume** (1M emails/day): ~$3,500/month
- Most cost from SES ($0.10/1000 emails)

---

## Implementation Roadmap

### Phase 1: MVP (2-3 weeks)

**Week 1: Core Infrastructure**
- [ ] Set up CDK project structure
- [ ] Create VPC (if needed) and networking
- [ ] Configure SES domain identity and DKIM
- [ ] Create DynamoDB tables (EmailTracking, SuppressionList)
- [ ] Set up IAM roles and policies
- [ ] Deploy CloudFormation stack

**Week 2: Email Sending**
- [ ] Implement Lambda EmailSender function
- [ ] Create API Gateway endpoints
- [ ] Configure SES configuration set
- [ ] Implement suppression list check
- [ ] Add basic error handling
- [ ] Write unit tests

**Week 3: Event Processing & Integration**
- [ ] Create SNS topics for SES events
- [ ] Implement Lambda EventProcessor function
- [ ] Implement backend webhook integration
- [ ] Add DLQ for failed processing
- [ ] Set up CloudWatch logging
- [ ] End-to-end testing

### Phase 2: Production Readiness (2 weeks)

**Week 4: Monitoring & Operations**
- [ ] Create CloudWatch dashboards
- [ ] Configure CloudWatch alarms
- [ ] Enable X-Ray tracing
- [ ] Set up log aggregation
- [ ] Create runbook documentation
- [ ] Load testing

**Week 5: Security & Compliance**
- [ ] Enable encryption at rest
- [ ] Implement API key rotation
- [ ] Configure VPC endpoints
- [ ] Security audit and pen testing
- [ ] Compliance review (GDPR, CAN-SPAM)
- [ ] Production deployment

### Phase 3: Enhancements (4 weeks)

**Week 6-7: Advanced Features**
- [ ] Implement email templates
- [ ] Add scheduled email sending
- [ ] Implement email open/click tracking
- [ ] Create email analytics dashboard
- [ ] Add bulk email API

**Week 8-9: Optimization & Scale**
- [ ] Implement caching layer
- [ ] Add SQS buffering for high volume
- [ ] Optimize Lambda memory and timeout
- [ ] Performance tuning
- [ ] Cost optimization

### Phase 4: Future Enhancements (Backlog)

- [ ] Email template editor UI
- [ ] A/B testing for email content
- [ ] Email scheduling and campaigns
- [ ] Advanced analytics (open rates, click rates)
- [ ] Webhook retry dashboard
- [ ] Email preview and testing tools
- [ ] Multi-region deployment
- [ ] GraphQL API option

---

## Open Questions

### Technical Decisions

1. **What is the expected email volume?**
   - Daily: ___________
   - Peak hourly: ___________
   - Helps determine: SQS buffering need, SES quota request, DynamoDB capacity

2. **How should the backend be notified?**
   - Option A: REST webhook (push)
   - Option B: SQS queue (pull)
   - Option C: WebSocket (real-time push)
   - Option D: EventBridge event bus

3. **What is the backend webhook URL and authentication?**
   - URL: ___________
   - Auth method: API key, JWT, HMAC signature?
   - Retry expectations: ___________

4. **Email types to support?**
   - [ ] Transactional only
   - [ ] Marketing/promotional
   - [ ] Bulk emails
   - Impacts: Rate limiting, queue design, compliance

5. **Do we need to receive emails?**
   - [ ] Yes - Need SES receive rules, S3 bucket, Lambda processor
   - [ ] No - Send-only architecture

6. **Template management?**
   - [ ] Use SES templates
   - [ ] Custom template engine (Handlebars, Mustache)
   - [ ] Backend provides rendered HTML

7. **Tracking requirements?**
   - [ ] Open tracking (requires pixel tracking)
   - [ ] Click tracking (requires link rewriting)
   - [ ] Unsubscribe link management

8. **Multi-region deployment?**
   - [ ] Yes - Need cross-region replication, global DynamoDB
   - [ ] No - Single region deployment

### Business Requirements

9. **Compliance requirements?**
   - [ ] GDPR (Europe)
   - [ ] CCPA (California)
   - [ ] HIPAA (Healthcare)
   - [ ] SOC 2
   - [ ] PCI DSS

10. **Data retention policy?**
    - Email metadata: ___________ days
    - Email content: Store? ___________ days
    - Suppression list: Indefinite or ___________ days

11. **SLA requirements?**
    - Uptime: ___________% (99.9% = ~43 min/month downtime)
    - Email delivery latency: ___________ seconds
    - Status update latency: ___________ seconds

12. **Budget constraints?**
    - Monthly budget: $___________
    - Cost per email target: $___________

---

## Appendix

### A. SES Event Examples

#### Bounce Event
```json
{
  "eventType": "Bounce",
  "bounce": {
    "bounceType": "Permanent",
    "bounceSubType": "General",
    "bouncedRecipients": [
      {
        "emailAddress": "bounce@example.com",
        "action": "failed",
        "status": "5.1.1",
        "diagnosticCode": "smtp; 550 5.1.1 user unknown"
      }
    ],
    "timestamp": "2025-11-01T10:00:05.000Z",
    "feedbackId": "0100018c7e8a1234-abcd1234-efgh5678-0000-000000000000-000000",
    "reportingMTA": "dsn; a8-50.smtp-out.amazonses.com"
  },
  "mail": {
    "timestamp": "2025-11-01T10:00:00.000Z",
    "source": "noreply@example.com",
    "sourceArn": "arn:aws:ses:us-east-1:123456789012:identity/example.com",
    "sendingAccountId": "123456789012",
    "messageId": "0100018c7e8a1234-abcd1234-efgh5678-ijkl9012-000000000000-000000",
    "destination": ["bounce@example.com"],
    "headersTruncated": false,
    "headers": [
      {
        "name": "X-Email-Id",
        "value": "550e8400-e29b-41d4-a716-446655440000"
      }
    ],
    "commonHeaders": {
      "from": ["noreply@example.com"],
      "to": ["bounce@example.com"],
      "subject": "Test Email"
    }
  }
}
```

#### Complaint Event
```json
{
  "eventType": "Complaint",
  "complaint": {
    "complainedRecipients": [
      {
        "emailAddress": "complaint@example.com"
      }
    ],
    "timestamp": "2025-11-01T10:05:00.000Z",
    "feedbackId": "0100018c7e8a1234-abcd1234-efgh5678-0000-000000000000-000000",
    "userAgent": "Yahoo!-Mail-Feedback/2.0",
    "complaintFeedbackType": "abuse",
    "arrivalDate": "2025-11-01T10:00:05.000Z"
  },
  "mail": {
    "timestamp": "2025-11-01T10:00:00.000Z",
    "source": "noreply@example.com",
    "messageId": "0100018c7e8a1234-abcd1234-efgh5678-ijkl9012-000000000000-000000",
    "destination": ["complaint@example.com"]
  }
}
```

### B. CDK Construct Ideas

```typescript
// High-level construct example
export class EnterpriseEmailStack extends Stack {
  constructor(scope: Construct, id: string, props: EnterpriseEmailStackProps) {
    super(scope, id, props);

    // Domain setup
    const domain = new ses.EmailIdentity(this, 'Domain', {
      identity: ses.Identity.domain(props.domainName),
      dkimSigning: true,
    });

    // Configuration set
    const configSet = new ses.ConfigurationSet(this, 'ConfigSet', {
      configurationSetName: 'enterprise-email',
      reputationMetrics: true,
    });

    // SNS topics for events
    const deliveryTopic = new sns.Topic(this, 'DeliveryTopic');
    const bounceTopic = new sns.Topic(this, 'BounceTopic');
    const complaintTopic = new sns.Topic(this, 'ComplaintTopic');

    // Event destinations
    configSet.addEventDestination('Delivery', {
      destination: ses.EventDestination.snsTopic(deliveryTopic),
      events: [ses.EmailSendingEvent.DELIVERY],
    });

    // DynamoDB tables
    const emailTable = new dynamodb.Table(this, 'EmailTracking', {
      partitionKey: { name: 'emailId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.ON_DEMAND,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Lambda functions
    const senderFunction = new lambda.Function(this, 'EmailSender', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/sender'),
      environment: {
        EMAIL_TABLE: emailTable.tableName,
        CONFIG_SET_NAME: configSet.configurationSetName,
      },
    });

    emailTable.grantReadWriteData(senderFunction);
    senderFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // API Gateway
    const api = new apigateway.RestApi(this, 'EmailApi', {
      restApiName: 'Enterprise Email Service',
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
    });

    const sendEmailIntegration = new apigateway.LambdaIntegration(senderFunction);
    api.root.addResource('send-email').addMethod('POST', sendEmailIntegration, {
      apiKeyRequired: true,
    });

    // Event processor
    const processorFunction = new lambda.Function(this, 'EventProcessor', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/processor'),
      environment: {
        EMAIL_TABLE: emailTable.tableName,
        WEBHOOK_SECRET_ARN: props.webhookSecretArn,
      },
    });

    deliveryTopic.addSubscription(new subscriptions.LambdaSubscription(processorFunction));
    bounceTopic.addSubscription(new subscriptions.LambdaSubscription(processorFunction));
    complaintTopic.addSubscription(new subscriptions.LambdaSubscription(processorFunction));

    emailTable.grantReadWriteData(processorFunction);
  }
}
```

### C. References

- [AWS SES Developer Guide](https://docs.aws.amazon.com/ses/)
- [AWS CDK API Reference](https://docs.aws.amazon.com/cdk/api/v2/)
- [SES Best Practices](https://docs.aws.amazon.com/ses/latest/dg/best-practices.html)
- [Email Authentication (SPF, DKIM, DMARC)](https://docs.aws.amazon.com/ses/latest/dg/email-authentication.html)
- [CAN-SPAM Act Compliance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [GDPR Email Marketing Guidelines](https://gdpr.eu/email-encryption/)

---

**Document Control**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-01 | System Architect | Initial draft |

**Approval**

- [ ] Technical Review: ___________
- [ ] Security Review: ___________
- [ ] Compliance Review: ___________
- [ ] Business Approval: ___________

---

*End of Document*
