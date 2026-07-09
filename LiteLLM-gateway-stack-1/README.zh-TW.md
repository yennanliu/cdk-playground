# LiteLLM AI Gateway（CDK / TypeScript）

> [English version](README.md)

在 AWS 上部署 [LiteLLM proxy](https://docs.litellm.ai/docs/simple_proxy)，作為一個集中式、相容 OpenAI 介面的 **AI Gateway**：

```
VPC → Aurora PostgreSQL Serverless v2 → ECS Fargate + ALB（LiteLLM）
```

不使用 Redis。Provider 的 API keys 與模型皆於部署後在 LiteLLM Admin UI 中新增。

- **系統設計：** [`doc/litellm-gateway-aws-design-claude.md`](doc/litellm-gateway-aws-design-claude.md)
- **實作計畫：** [`doc/litellm-gateway-implementation-claude.md`](doc/litellm-gateway-implementation-claude.md)
- **除錯與測試：** [`doc/debugging-and-testing.md`](doc/debugging-and-testing.md)
- **可改進項目：** [`doc/improvements.md`](doc/improvements.md)

## 指令

```bash
npm install
npm run lint     # tsc --noEmit（型別檢查）
npm run build    # 編譯
npm test         # 單元測試 + 快照測試
npm run clean    # 移除 lib 與 bin 中編譯產生的 *.js / *.d.ts
npx cdk synth
npx cdk deploy
```

## 部署

```bash
# HTTP（POC）— 透過 ALB DNS 名稱存取
npx cdk deploy

# HTTPS（正式環境）— 自動建立 ACM 憑證 + Route 53 記錄 + HTTP→HTTPS 轉址
npx cdk deploy \
  -c domainName=gateway.example.com \
  -c hostedZoneId=Z0123456789ABCDEFGHIJ \
  -c zoneName=example.com
```

整個 stack 及其中所有可追蹤的資源（DB cluster、ECS cluster/service、ALB、log
group）皆以 `<appName>-<version>` 命名，預設為 `litellm-gateway-v1`。可用
`-c appName=... -c version=...` 覆寫；**只要提升版本號，就能建立一個獨立命名的全新
stack**，與舊的並存或取代舊的（詳見[部署注意事項](#部署注意事項)）：

```bash
npx cdk deploy -c version=v2
```

Stack 輸出包含 `GatewayUrl`、`AdminUiUrl`、`MasterKeySecretArn` 與 `AlarmTopicArn`。

## 部署後步驟

1. **取得 master key。** 它是 `sk-` 加上 `MasterKeySecretArn` secret 中的值：
   ```bash
   echo "sk-$(aws secretsmanager get-secret-value \
     --secret-id <MasterKeySecretArn> --query SecretString --output text)"
   ```
2. **開啟 Admin UI**（`AdminUiUrl`），以該 master key 登入。
3. **新增模型與 provider keys**：於 *Models → Add Model*。Bedrock 不需要 key（task role 已具備 `bedrock:InvokeModel*`）；OpenAI/Anthropic 等則貼上一組 key，會透過 salt key 加密存放於 Postgres。
4. **為每個 app/team 建立 virtual keys**（含預算/速率限制），再把這些 `sk-...` keys 交給用戶端。
5. **訂閱告警：** 在 SNS topic（`AlarmTopicArn`）上新增 email/Slack 端點。

## 用戶端使用方式（任何 OpenAI SDK）

```python
from openai import OpenAI
client = OpenAI(base_url="<GatewayUrl>", api_key="sk-team-virtual-key")
client.chat.completions.create(
    model="claude-sonnet",  # 你在 UI 中設定的 model_name
    messages=[{"role": "user", "content": "Hello"}],
)
```

## 開發注意事項

- **清除編譯產物。** `tsc` 會在 `lib/` 與 `bin/` 的原始碼旁產生 `*.js` / `*.d.ts`。提交前執行 `npm run clean`，或用 `npm run lint`（`tsc --noEmit`）做不產生檔案的型別檢查。
- **快照測試會攔截結構性變更。** `npm test` 會跑單元測試與快照測試；任何對合成模板（synthesized template）的改動都會使快照測試失敗。請檢視 diff，若變更符合預期再用 `npx jest -u` 更新快照。
- **`config/litellm-config.yaml` 並未被套用。** 容器以 `STORE_MODEL_IN_DB=True` 執行且未帶 `--config`——模型與 keys 存於 Postgres，並由 Admin UI 管理。該 YAML 只是給偏好將設定烘焙進自訂 image 的團隊參考。
- **啟動流程是一層 shell wrapper。** Task 進入點會在執行期從注入的 secrets 組出 `DATABASE_URL` 及加上 `sk-` 前綴的 master/salt keys，因此不會有任何 secret 被寫進 task definition 或 image。若你更動了環境變數/secret 名稱，記得同步更新 `startupCommand`。

## 部署注意事項

- **版本化、可拋棄的 stacks。** 資源以 `<appName>-<version>` 命名。提升 `-c version=v2` 即可乾淨地重新部署（全新且無命名衝突的 DB/ECS/ALB），並以 `npx cdk destroy -c version=v1` 拆除舊的——不會留下改到一半、名稱錯亂的資源要追。
- **首次部署較慢（約 10–15 分鐘）。** 主要耗在 Aurora 佈建，且 task 啟動時會先跑 Prisma DB migration 才能通過健康檢查。Target group 為此設了 **180 秒的健康檢查寬限期**——請勿縮短，否則首批 task 會在 migration 進行中被殺掉。
- **記憶體刻意設為 4 GB。** LiteLLM 會跑 2 個 uvicorn workers 加上內建的 Prisma engine；在 2 GB 時容器會在轉為健康前就被 OOM 殺掉（exit 137）。搭配 1 vCPU 時請保持 ≥4 GB。
- **HTTPS 需要你自己掌控的 Route 53 hosted zone。** `domainName`、`hostedZoneId`、`zoneName` 三者必須一起提供；在 DNS 記錄解析出來之前，ACM 憑證驗證會卡住部署。未提供時，ALB 會以純 HTTP 在 `:80` 提供服務。
- **Salt key 不可變更** — 輪替 `SaltKeySecret` 會使已存放的 provider keys 無法解密；它設為 `RemovalPolicy.RETAIN`，且在 `cdk destroy` 後仍會保留（若你真要刪，需手動刪除）。
- **開發 vs 正式** — DB 在開發環境用 `RemovalPolicy.DESTROY`；正式環境請改為 `SNAPSHOT`/`RETAIN`。
- **不使用 Redis** — 速率限制是「每個 replica 各自計算」的近似值。若你需要精確、跨叢集的限制或回應快取，請加上 ElastiCache（詳見系統設計文件）。
