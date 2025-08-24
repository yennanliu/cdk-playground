# Redis-sentinel-2

## To Test Features

Core Testing Capabilities

  Connection Testing:
  - Test connectivity to all Redis instances
  - Test connectivity to all Sentinel instances
  - Validate service discovery resolution
  - Test failover scenarios (simulate master failure)

  Data Operations Testing:
  - Write/read operations to current master
  - Verify data replication across slaves
  - Test data consistency during failover
  - Benchmark read/write performance

  Sentinel Monitoring:
  - Monitor master/slave topology
  - Track sentinel votes and quorum status
  - Display failover history and timing
  - Show configuration drift detection