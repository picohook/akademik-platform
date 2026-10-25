# R2 usage and quotas — agreed follow-up, 2026-10-25

Status: recorded, not implemented. Owner requested that this be kept for follow-up.

- Track total storage and Class A/B operations across the account's relevant buckets.
- Add per-user storage quotas for personal uploads; values are not decided yet.
- Keep LibEdge collection, institutional content and personal usage separate in accounting.
- Check quota on the server, including concurrent/reserved uploads. Release reservations
  and return usage on confirmed deletion. Avoid counting one shared book per reader.
- Add admin usage visibility and billing/threshold notifications; thresholds remain undecided.
- Do not treat the R2 free allowance as a configured hard spending/storage cutoff.
- Public Standard pricing checked on 2026-10-25: 10 GB-month storage, 1 million
  Class A operations/month and 10 million Class B operations/month included;
  excess storage $0.015/GB-month, excluding operations/tax. Account-specific
  entitlements/billing settings have not been inspected.
- Source: https://developers.cloudflare.com/r2/pricing/
- OA reader files in the first package: 122,355,349 bytes; this excludes source ZIPs.

Follow up after the initial content import and before personal uploads are widely enabled.
