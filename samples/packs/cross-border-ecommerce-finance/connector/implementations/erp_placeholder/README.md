# ERP connector placeholder (Phase 2 v1.1)

Pick **one** ERP first (积加 or 领星):

- Auth: appId + appSecret → `extension-secrets.json` → `user.*` connector subprocess
- Pull: orders / ads / inventory OpenAPI endpoints
- Map: vendor fields → `feeds/*.schema.json` canonical columns
- Write: same temp sheet names as `csv_local` (`Pack_订单` …)

Recipe and Skill layers **must not change** when switching from `csv_local` to `erp_*`.

Do not import ERP SDKs into `backend/` core or `addin/skills/core`.
