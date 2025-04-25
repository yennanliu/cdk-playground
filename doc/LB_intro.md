# Load Balancer Intro

🚦 AWS Load Balancer Types (with Comparison)

1. Application Load Balancer (ALB)

Ideal for: Web apps, REST APIs, Microservices

Feature	Description
Layer	Operates at Layer 7 (HTTP/HTTPS) — Application Layer
Routing	Smart routing based on: URL path, hostname, query strings, HTTP headers, methods
Use cases	Host-based routing (/api, /app), routing by hostname (api.example.com vs www.example.com)
WebSockets	✅ Supports WebSocket connections
TLS Termination	✅ Yes
Target types	Instance, IP, Lambda
Health checks	App-level (e.g., /healthz)
Pricing	Slightly more expensive than NLB per request, but you get richer features

🧠 Think: “Smart router” for HTTP(S) traffic.

⸻

2. Network Load Balancer (NLB)

Ideal for: Low-latency, high-throughput apps, TCP traffic

Feature	Description
Layer	Operates at Layer 4 (TCP/UDP) — Transport Layer
Routing	Based on IP protocol data only (no access to HTTP headers)
Use cases	Load balance TCP traffic (e.g., gaming servers, VoIP, or microservices that use gRPC/TCP)
TLS Termination	✅ Optional with TLS listener
Performance	Handles millions of requests/sec with very low latency
Static IP / Elastic IP	✅ Yes
Preserves client IP	✅ Yes
Target types	Instance, IP, ALB (in some use cases)

🧠 Think: “Superfast TCP load balancer” for non-HTTP traffic.

⸻

3. Classic Load Balancer (CLB) (Legacy — avoid for new projects)

Ideal for: Older apps that haven’t been updated

Feature	Description
Layer	Supports Layer 4 & 7 (less intelligent than ALB/NLB)
Routing	Basic round-robin
Use cases	Legacy apps or simple HTTP/S balancing
Modern features	❌ Lacks modern features like path-based routing, WebSockets, or advanced metrics
Deprecated?	Not officially, but AWS recommends ALB/NLB

🧠 Think: “Basic load balancer” for pre-2016 apps.

⸻

⚖️ Summary Table

Feature	ALB	NLB	CLB
OSI Layer	7 (HTTP)	4 (TCP/UDP)	4 & 7
Target types	EC2, IP, Lambda	EC2, IP	EC2 only
WebSockets support	✅	❌	❌
Host/Path-based routing	✅	❌	❌
TLS termination	✅	✅	✅
Static IP	❌	✅	❌
Preserves client IP	❌	✅	❌
Pricing (approx.)	Medium	Low	Medium
Preferred use	HTTP apps	TCP, gRPC	Legacy only



⸻

✅ When to Use What

Scenario	Recommended LB
Web app / REST API	ALB
gRPC / TCP / IoT / Financial apps	NLB
Legacy app (pre-2016)	CLB (if needed)
Real-time game server	NLB
API Gateway alternative (for simple routing)	ALB



⸻


##  What Happens if You Use NLB for a REST API ?

Nice one — this is exactly the kind of edge case we’d bring up in a systems design or architecture review. Let’s break it down clearly:

⸻

🤔 What Happens if You Use NLB for a REST API?

You technically can use an NLB (Network Load Balancer) to front a REST API — but it’s not ideal, and here’s why:

⸻

⚠️ What You Lose (Compared to ALB)

Missing Feature	Why It Matters for REST APIs
❌ Layer 7 routing	You can’t do path-based (/users, /orders) or host-based routing — NLB doesn’t understand HTTP.
❌ Header-based routing	Can’t route based on content-type, auth headers, etc.
❌ Query param inspection	NLB can’t inspect ?foo=bar — it just passes packets through.
❌ Advanced health checks	NLB does TCP-level health checks (is port open?), but not GET /healthz app checks.
❌ Built-in WebSocket support	Not as seamless as ALB for long-lived HTTP connections.
❌ Lambda targets	NLB can’t forward to AWS Lambda — ALB can.
❌ Logging/Monitoring	Limited to basic CloudWatch metrics; no per-path insights or access logs like ALB offers.



⸻

✅ What You Get (When Using NLB)

NLB Strength	Comment
🔒 Static IP / Elastic IPs	Can be useful if clients require a fixed IP (e.g., firewall rules)
⚡ Ultra-low latency	Useful for raw TCP/UDP connections (game servers, fintech, IoT)
💪 High throughput	Scales to millions of connections per second
🔁 Preserves client IP by default	ALB can do this with headers; NLB does it natively
🔐 TLS passthrough	NLB can pass encrypted traffic directly to backend, without decrypting it (for mutual TLS etc.)



⸻

👎 Why It’s Usually a Bad Fit for REST APIs

REST APIs use HTTP semantics:
	•	You want routing like /v1/users,
	•	You care about HTTP status codes, headers, etc.,
	•	You want detailed observability (access logs, request duration),
	•	You probably want to integrate with Lambda, ECS, or Fargate.

Since NLB just forwards TCP/UDP packets, it doesn’t “see” the HTTP layer — so all of that gets lost.

⸻

✅ Better Option

Use an Application Load Balancer (ALB) unless:
	•	You have a hard requirement for fixed IPs, or
	•	You’re handling non-HTTP protocols (like gRPC, WebSocket over TCP, or MQTT), or
	•	You need super-low latency and don’t care about HTTP logic

⸻

🔧 Real-World Analogy
	•	ALB = Smart receptionist who understands what the request is and routes it based on content.
	•	NLB = Bouncer who just lets packets through fast without asking questions.

⸻

