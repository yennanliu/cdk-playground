# 多租戶 SaaS 架構設計案例

## 情境

假設你要設計一個 **企業專案管理 SaaS 平台**（類似 Jira 或 Asana）。

不同公司（Tenant）使用同一個系統，但需要：

* 資料完全隔離
* 可客製設定
* 高擴展性
* 成本可控

---

# 一、整體系統架構

典型 SaaS 多租戶架構：

```
                +------------------+
                |  API Gateway     |
                +------------------+
                         |
                +------------------+
                | Auth Service     |
                | (Tenant Aware)   |
                +------------------+
                         |
        +-------------------------------------+
        |            Application Layer        |
        |-------------------------------------|
        | Project Service                     |
        | Task Service                        |
        | Notification Service                |
        +-------------------------------------+
                         |
                +------------------+
                | Tenant Resolver  |
                +------------------+
                         |
              +----------------------+
              |   Multi-Tenant DB    |
              +----------------------+
```

---

# 二、租戶識別（Tenant Identification）

常見三種方式：

### 1 Subdomain

```
https://companyA.app.com
https://companyB.app.com
```

request middleware

```pseudo
tenant = extractSubdomain(request.host)
```

---

### 2 Header

API request

```
X-Tenant-ID: companyA
```

---

### 3 JWT Token

登入後 token

```json
{
  "user_id": "123",
  "tenant_id": "companyA",
  "role": "admin"
}
```

middleware 解析 tenant。

---

# 三、資料庫隔離策略

多租戶最核心的設計。

## 方案 1：Shared DB + Shared Schema（最常見）

```
Table: tasks

id
tenant_id
title
status
created_at
```

query：

```sql
SELECT *
FROM tasks
WHERE tenant_id = 'companyA'
```

優點

* 成本最低
* 易於擴展

缺點

* 必須嚴格防止資料洩漏

通常會搭配：

* ORM middleware
* Row Level Security

---

## 方案 2：Shared DB + Separate Schema

```
tenant_a.tasks
tenant_b.tasks
tenant_c.tasks
```

優點

* 資料邏輯隔離

缺點

* schema migration 複雜

---

## 方案 3：Database per Tenant

```
DB_companyA
DB_companyB
DB_companyC
```

優點

* 最強隔離
* 客戶可單獨備份

缺點

* 成本高
* DevOps 複雜

---

# 四、Tenant Middleware 設計

API 進入時解析 tenant。

例：

```
Request
   |
Tenant Middleware
   |
Attach tenant_id to context
   |
Service Layer
   |
Database Query (auto filter)
```

Example：

```python
def get_tasks(user):
    tenant_id = user.tenant_id
    return db.query("SELECT * FROM tasks WHERE tenant_id=?", tenant_id)
```

---

# 五、租戶設定（Tenant Configuration）

SaaS 通常需要 **租戶客製化設定**

Example table

```
tenants
------
id
name
plan
settings_json
```

Example settings

```json
{
  "max_users": 100,
  "features": ["kanban", "reporting"]
}
```

---

# 六、權限與 RBAC

租戶內部需要角色管理

```
tenant_users
-------------
user_id
tenant_id
role
```

roles

```
Admin
Manager
Member
```

---

# 七、水平擴展設計

SaaS 必須能 scale。

常見方式

### Stateless API

API 不存 session

使用

* JWT
* Redis

---

### Cache

熱門資料

```
Redis

key:
tenant:123:project:456
```

---

### Queue

非同步任務

* Email
* Report
* Notification

常見工具：

* Apache Kafka
* RabbitMQ

---

# 八、Tenant Rate Limit

避免某個租戶拖慢系統

Example

```
Basic Plan
100 req/min

Enterprise
1000 req/min
```

API Gateway 控制。

---

# 九、監控與觀測

Metrics 必須 **tenant aware**

log example

```
tenant_id=companyA
endpoint=/tasks
latency=120ms
```

工具：

* Prometheus
* Grafana

---

# 十、Production SaaS 架構範例

成熟 SaaS（例如 Salesforce）通常包含：

```
CDN
 |
API Gateway
 |
Auth / Identity
 |
Microservices
 |
Tenant Isolation Layer
 |
Database Cluster
 |
Cache + Queue
 |
Monitoring
```

---

# 面試級回答（簡短版）

如果是在 **系統設計面試**，通常回答：

> 我會先設計 Tenant Identification（subdomain 或 JWT），
> 再選擇資料隔離策略（shared DB + tenant_id）。
>
> 在 Application Layer 使用 middleware 自動注入 tenant context，
> DB query 強制 tenant filter。
>
> 同時設計 RBAC、tenant configuration、rate limit。
>
> 為了 scale，我會使用 stateless API、Redis cache、message queue 以及 observability system。

---

💡 如果你願意，我可以再給你：

* **真實 SaaS 系統架構（AWS / GCP production version）**
* **多租戶資料庫 schema 完整設計**
* **多租戶 SaaS 常見 10 個架構坑（很多工程師會踩）**
* **SaaS System Design 面試完整回答模板**（非常實用）
