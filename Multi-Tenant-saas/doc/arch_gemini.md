## 核心架構方案：資料層的選擇

資料隔離是 SaaS 的靈魂，通常分為三種模式：

| 模式 | 優點 | 缺點 | 適用場景 |
| --- | --- | --- | --- |
| **Database-per-tenant** | 最高等級物理隔離、安全性高 | 維運成本極高、資源利用率低 | 銀行、政府、高併發大客戶 |
| **Schema-per-tenant** | 邏輯隔離、兼具擴展性與管理 | 資料庫連線池管理較複雜 | 中型企業 B2B 應用 |
| **Shared Schema (Column)** | 成本最低、支援海量租戶 | 隔離性差（靠 `tenant_id`）、容易有過大的表 | B2C、小微企業工具 |

---

## 實作範例：以「電商 ERP 系統」為例

假設我們正在設計一個服務全球賣家的 ERP 系統。

### 1. 身份識別與路由 (Tenant Resolver)

當請求進來時，系統必須第一時間識別租戶身份：

* **網域名稱：** `tenant-a.ssp.com` 或 `tenant-b.ssp.com`。
* **JWT Claims：** 在 Token 中夾帶 `tenant_id` 與 `tier`（等級）。
* **攔截器 (Interceptor)：** 在 Spring Boot 或 FastAPI 中透過 `ThreadLocal` 或 `ContextVars` 存放當前請求的租戶上下文。

### 2. 動態資料來源切換 (Dynamic Routing)

針對不同等級的客戶，我們可以採用不同的隔離策略。

* **Free Tier:** 多個租戶共用同一個 DB Instance，使用 `tenant_id` 過濾。
* **Enterprise Tier:** 系統根據上下文自動切換到該客戶專屬的資料庫連線。

```java
// Spring Boot 偽代碼：動態資料源路由
public class TenantRoutingDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        return TenantContext.getCurrentTenant(); // 從 ThreadLocal 取得 ID
    }
}

```

### 3. 分層架構設計

* **API Gateway:** 負責限流（Rate Limiting）。例如：VIP 租戶每秒 1000 次請求，免費租戶 100 次。
* **Application Service:** 業務邏輯中立化，不寫死任何租戶邏輯。
* **Big Data 層 (Flink/Spark):** 處理報表時，按 `tenant_id` 進行 Partition，確保資料清洗與分析不會跨庫污染。

---

## 進階考量：SaaS 的痛點處理

在實際營運中，還需要解決以下問題：

* **鄰居噪聲 (Noisy Neighbor):**
使用容器化（Kubernetes）對不同租戶的資源進行 CPU/Memory 限制（Resource Quotas），避免 A 租戶的高流量拖垮 B 租戶。
* **資料庫遷移 (Migrations):**
當你有 1000 個獨立 Schema 時，更新欄位會變成災難。需要自動化工具（如 Liquibase 或 Flyway）配合 CI/CD 流水線逐一部署。
* **自定義需求 (Customization):**
使用 **Feature Flags** 來控制不同租戶可用的功能，而非為單一客戶修改程式碼版本。
