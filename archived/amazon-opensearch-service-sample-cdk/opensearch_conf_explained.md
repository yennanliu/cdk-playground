## 💠 OpenSearch CDK Configuration

```json
{
  "engineVersion": "OS_2.5",
  "domainName": "os-service-domain-1",
  "useUnsignedBasicAuth": true,
  "enforceHTTPS": true,
  "tlsSecurityPolicy": "TLS_1_2",
  "encryptionAtRestEnabled": true,
  "nodeToNodeEncryptionEnabled": true,
  "openAccessPolicyEnabled": true
}
```

### 🔍 Field Descriptions

| Key                                 | Description                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `engineVersion: "OS_2.5"`           | Specifies the OpenSearch engine version to use (`OpenSearch 2.5`).                               |
| `domainName: "os-service-domain-1"` | The logical name of the OpenSearch domain.                                                       |
| `useUnsignedBasicAuth: true`        | Enables basic authentication without AWS SigV4 signing. For dev/test use only.                   |
| `enforceHTTPS: true`                | Enforces secure HTTPS communication for all incoming requests.                                   |
| `tlsSecurityPolicy: "TLS_1_2"`      | Requires clients to use at least TLS 1.2 for encrypted connections.                              |
| `encryptionAtRestEnabled: true`     | Enables encryption for data at rest using AWS KMS.                                               |
| `nodeToNodeEncryptionEnabled: true` | Encrypts traffic between OpenSearch nodes.                                                       |
| `openAccessPolicyEnabled: true`     | Applies an open access policy (i.e., wildcard `*`) for all users. Suitable for dev environments. |

### ⚠️ Security Note

This configuration is intended for **development and testing only**.
For production, consider:

* Using fine-grained access control (FGAC)
* Requiring SigV4-signed requests
* Locking down access via VPC and IAM policies
* Disabling `openAccessPolicyEnabled` and `useUnsignedBasicAuth`
