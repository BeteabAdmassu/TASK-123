# Business Logic Questions & Decisions

## Decisions Log

1. **[Authentication / User Management]**
   - **Question**: The prompt says "local password" for sensitive field reveal but never specifies a general login flow. Is there a login screen? How are user accounts created? Is there a default admin?
   - **My Understanding**: Since this is a multi-role desktop app with role-based access, there must be authentication. The Administrator creates user accounts locally. On first install, a default admin account is seeded.
   - **Decision**: Implement local JWT-based login. Admin creates accounts. First-run setup seeds a default `admin/admin` account that forces password change on first login.
   - **Impact**: If the app is intended as single-user without login, a significant portion of auth, role, and multi-user logic would be unnecessary.

2. **[Resume Version Retention — Pruning Strategy]**
   - **Question**: The prompt says "max 50 versions retained." When version 51 is saved, is the oldest version deleted? Is the user warned? Are deleted versions kept in audit trail? Does deletion cascade to attachments linked to that version?
   - **My Understanding**: FIFO pruning — oldest version is auto-deleted when the 51st version is saved, with an audit trail entry recording the pruning.
   - **Decision**: Automatically delete the oldest version when saving version 51+. Log the pruning event in the audit trail. Attachments are per-candidate, not per-version, so they remain unaffected.
   - **Impact**: If versions should never be hard-deleted (compliance requirement), we'd need a different archival strategy or configurable retention.

3. **[Multi-Level Approval — Number of Levels and Approver Assignment]**
   - **Question**: How many approval levels are there? Who assigns approvers to each level? Can the number of levels vary per request type? The prompt mentions "multi-level" and "joint-sign" vs "any-sign" but not the configuration mechanics.
   - **My Understanding**: Approval chains are configurable by the Administrator. The number of steps varies per approval template. Recruiters select the template when creating an approval request.
   - **Decision**: Admin configures approval templates with N ordered steps, each with assigned approver(s) and mode (joint/any). When creating a request, the template is selected and steps are instantiated.
   - **Impact**: If approvals are ad-hoc (requester manually picks approvers each time), the template system would be over-engineered and a simpler picker UI would be needed.

4. **[Credit Change — What Is Being Changed?]**
   - **Question**: "Credit Change workflow" is mentioned but the prompt never defines what a "credit" is in this context. Is it a monetary credit to a service, a billing adjustment, a candidate compensation change, or something else?
   - **My Understanding**: "Credit change" likely refers to financial adjustments within the Service Catalog context (e.g., pricing adjustments, billing credits, or compensation changes for candidates) that require multi-level sign-off due to their financial impact.
   - **Decision**: Implement credit change as a generic financial adjustment entity with amount, reason, and entity reference (could be tied to a service specification or candidate). The approval workflow is the focus, not the domain-specific semantics.
   - **Impact**: If "credit change" has a very specific business meaning (e.g., a particular HR/payroll operation), the data model fields and validation rules might need adjustment.

5. **[Violation Detection — When Does Scanning Occur?]**
   - **Question**: Are violation scans triggered on every candidate save? Only on resume version save? On a manual trigger? On status changes? The prompt says "rule-based and local" but not when it runs.
   - **My Understanding**: Violations should be detected proactively — on candidate save and resume version save — to catch issues early. A manual re-scan endpoint is also available.
   - **Decision**: Run violation scan automatically on candidate create/update and resume version save. Provide a manual "Scan" button and API endpoint for on-demand re-scanning. Scan results are idempotent — duplicate violations for the same rule+field are not re-created.
   - **Impact**: If scanning is only manual, the automatic trigger code is unnecessary. If scanning should run on more events (e.g., attachment upload), additional hooks are needed.

6. **[Service Catalog — Capacity Reset Cadence]**
   - **Question**: Daily capacity has a "hard stop once reached," but when does `current_daily_orders` reset? Midnight local time? Start of business? Is it per-calendar-day or per-rolling-24h?
   - **My Understanding**: Per calendar day, resetting at midnight local time (the workstation's system clock).
   - **Decision**: Use a `CapacityPlan` table keyed by `(spec_id, date)`. A new row is created for each day. Current volume is tracked per-day, and the hard stop is enforced by comparing against `max_volume`. No row = no orders yet = capacity available (up to the spec's default).
   - **Impact**: If capacity needs to reset at a configurable time (e.g., 6 AM) or per shift, the date-based approach needs a time offset.

7. **[Notification Delivery Receipts — "Opened" Tracking for Exports]**
   - **Question**: The prompt says delivery receipts are "generated/opened/acknowledged." For in-app notifications, "opened" makes sense (user clicked it). But for email/SMS exports (files written to disk), how is "opened" detected? The app doesn't send real emails.
   - **My Understanding**: For exports, "generated" means the file was written. "Opened" is tracked only for in-app notifications (when the user views it). "Acknowledged" is an explicit user action on any notification type.
   - **Decision**: In-app notifications support all three states. Email/SMS export notifications support "generated" and "acknowledged" (manually marked) but "opened" is skipped since there's no way to detect it for a file written to disk.
   - **Impact**: If the evaluator expects all three states for all types, we'd need to add a file-opened watcher or a manual "mark as opened" step for exports.

8. **[Geospatial — PostGIS vs. Application-Level Spatial Indexing]**
   - **Question**: The prompt says "local spatial indexing." Should this use PostGIS (which is a PostgreSQL extension), or a JavaScript-based spatial library like Turf.js with in-memory indexing (e.g., rbush)?
   - **My Understanding**: Since PostgreSQL is already the database, PostGIS is the natural choice for spatial indexing and server-side queries. Turf.js handles client-side analysis and visualization. Both are used.
   - **Decision**: Use PostGIS for storage and spatial queries (ST_Within, ST_Buffer, ST_Intersects, clustering). Use Turf.js in the Angular frontend for lightweight client-side analysis. Use Leaflet with local vector tiles for rendering.
   - **Impact**: If PostGIS is not available in the bundled PostgreSQL installer, we'd need to bundle it separately or fall back to pure application-level indexing with rbush, which limits query capabilities.

9. **[Crash Recovery Checkpoints — Scope and Granularity]**
   - **Question**: The prompt says checkpoints every 30 seconds restore "last viewed record, draft forms, and approval inbox state." Does this mean all unsaved form state across all open windows? What about multi-window state (window positions, sizes)?
   - **My Understanding**: Checkpoint captures: (a) IDs of the currently viewed records in each open window, (b) unsaved form field values as a serialized snapshot, (c) the approval inbox filter/scroll state. Window positions/sizes are handled separately by Electron's built-in window state persistence.
   - **Decision**: Every 30 seconds, serialize the current navigation state (open windows + active record IDs), all dirty form data (via Angular form value snapshots), and inbox filter state into a JSON blob stored in `AppCheckpoint`. On crash recovery, restore the last checkpoint and rehydrate windows/forms. Electron handles window geometry separately.
   - **Impact**: If form state includes large file upload progress or map viewport state, the checkpoint payload could become large and need chunking or selective capture.

10. **[Encryption Key Management]**
    - **Question**: Sensitive fields are "encrypted at rest" but the prompt doesn't specify key management. Where is the encryption key stored? Is it derived from the user's password? Is there a master key? What happens if the key is lost?
    - **My Understanding**: A master encryption key is generated on first install and stored securely on the local machine (OS keychain / DPAPI on Windows). Individual field encryption uses the master key. Password re-entry for reveal is an authorization check, not a decryption key derivation.
    - **Decision**: Generate a 256-bit AES master key on first install, store it via Electron's `safeStorage` API (uses OS credential store / DPAPI on Windows). Field-level encryption uses AES-256-GCM with random IVs per field. Password re-entry is an auth check that gates the API call to decrypt and return the field value.
    - **Impact**: If the key should be password-derived (so data is unrecoverable without the password), the design changes to PBKDF2-derived keys and data becomes unrecoverable if the password is forgotten.

11. **[Duplicate Username / Duplicate Candidate Handling]**
    - **Question**: What happens when an admin tries to create a user with a duplicate username? What about duplicate candidates (same name + same job posting)? Are duplicate candidates allowed?
    - **My Understanding**: Duplicate usernames are rejected (UNIQUE constraint). Duplicate candidates by name are allowed since different people can share names, but duplicate SSN patterns are flagged by the violation scanner.
    - **Decision**: Enforce unique usernames at the database level, return 409 Conflict on duplicates. Allow duplicate candidate names. SSN duplication is handled by the violation detection system (flagged, not blocked).
    - **Impact**: If business rules require blocking duplicate candidates entirely (not just flagging), we'd need a hard constraint rather than a soft violation.

12. **[Offline Update — Package Format and Verification]**
    - **Question**: The prompt says "imports a versioned update package from disk/USB." What format is this package? How is integrity verified? Is the package signed? What is the rollback mechanism — does it keep the previous version's files?
    - **My Understanding**: The update package is a self-contained archive (e.g., `.zip` or `.nupkg`) containing the new app version, a manifest with version info, and a signature for integrity. Rollback keeps the previous version's files in a backup directory.
    - **Decision**: Update packages are signed `.zip` archives containing the new Electron app bundle and a `manifest.json` with version, checksum, and signature. On update: (1) verify signature, (2) backup current version to `previous/`, (3) extract new version, (4) restart. Rollback swaps `current/` and `previous/` directories.
    - **Impact**: If the evaluator expects a specific update framework (e.g., Squirrel, electron-updater in offline mode), our custom approach might not match expectations.

13. **[Pagination — Cursor vs. Offset]**
    - **Question**: The prompt never mentions pagination, but list endpoints will need it. What style — offset-based or cursor-based? What default page size?
    - **My Understanding**: For a local desktop app with moderate data volumes, offset-based pagination is simpler and sufficient.
    - **Decision**: Implement offset-based pagination with `?page=1&pageSize=25` query params. Default page size = 25, max = 100. Return `{ data, total, page, pageSize }` envelope.
    - **Impact**: If datasets grow very large (geospatial features), cursor-based pagination would be more performant. We'll use cursor-based specifically for the geo features endpoint.

14. **[Soft Delete vs. Hard Delete]**
    - **Question**: The prompt doesn't specify deletion behavior. Should candidates, projects, or services be soft-deleted (marked inactive) or hard-deleted?
    - **My Understanding**: Given the compliance/audit focus, soft delete is safer. Hard delete would break audit trail references.
    - **Decision**: Implement soft delete for all core entities (candidates, projects, postings, services) using an `archived_at` timestamp. Audit trail entries are never deleted. Tags and attachments can be hard-deleted since they're supplementary.
    - **Impact**: If hard delete is expected, the archived_at field and filter logic are unnecessary. If soft delete is required for all entities including tags, we'd need to extend it.

15. **[Spanish Localization Scope]**
    - **Question**: The prompt says "English plus one additional locale (e.g., Spanish)." Does this mean the entire UI is translated, or just date/currency formatting? Are user-generated content fields (candidate names, descriptions) bilingual, or just the chrome?
    - **My Understanding**: The application chrome (labels, buttons, messages, validation errors) is fully translated. User-generated content is stored as-is in whatever language the user types. Date and currency formatting follows locale conventions.
    - **Decision**: Full i18n of all UI strings via Angular `@angular/localize` with `en.json` and `es.json` translation files. Date pipe uses MM/DD/YYYY for en-US locale. Currency pipe formats as `$1,234.00`. User-generated content is not auto-translated.
    - **Impact**: If bilingual data entry is expected (e.g., job posting title in both English and Spanish), the data model needs dual-language text fields.
