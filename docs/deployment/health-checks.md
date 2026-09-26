# Health Probes & Monitoring Contract

> **Specification Reference:** Section 4.8 & 14.18

The LifeStyle API exposes two unversioned, unauthenticated health probes designed for load balancer routing and container orchestrators:

## 1. Liveness Probe (`GET /health/live`)

* **Purpose:** Determines if the Node.js process event loop is active and responsive.
* **HTTP Status:** `200 OK`
* **Response Body:**
  ```json
  {
    "status": "ok"
  }
  ```
* **Orchestrator Action:** If the liveness probe fails for three consecutive attempts, Kubernetes or Docker restarts the container.

---

## 2. Readiness Probe (`GET /health/ready`)

* **Purpose:** Determines whether the process can actively serve traffic. Probes connectivity to PostgreSQL (`SELECT 1`) and Redis (`PING`) with a strict 1000 ms timeout.
* **HTTP Status Codes:**
  * `200 OK`: Both PostgreSQL and Redis are responsive, and process is not draining.
  * `503 Service Unavailable`: PostgreSQL or Redis is unreachable, or process has entered graceful shutdown.
* **Response Body:**
  ```json
  {
    "status": "ok"
  }
  ```
  *(or `{"status": "degraded"}` on failure)*
* **Security Invariant:** Never returns hostnames, software version numbers, or database error traces.
* **Graceful Shutdown Behavior:** When `SIGTERM` is received, readiness immediately flips to `503 degraded` to signal the load balancer to remove the instance from the routing pool while in-flight requests finish draining.
