# Read-only schema inventory (diagnostic only)

This is **not** a migration, deletion script, production access tool or release
approval. It compares selected PostgreSQL `public` catalog metadata; it never
reads application rows. See [current blockers](ERASURE_STATUS.md).

## Collection

1. Generate a baseline on an isolated database built with the exact intended
   release migrations, using `schema-inventory-readonly.sql`. The same SQL may
   be run separately in Neon SQL Editor on the verified intended database and
   branch. Do not use a clone or baseline as proof of the live target's identity.
2. Export the result as JSON: an array of objects with exactly `kind`,
   `relation_name`, `object_name` and `detail`. `detail` can be a JSON object
   or a JSON-encoded string. Neon editor's JSON export should be inspected for
   that shape. Do not export data rows, connection strings, environment variables
   or authentication details. Review the metadata and object names for sensitive
   information before sharing. Expression fingerprints are not encryption.
3. Store inventories outside the repository and restrict access. Compare them
   offline with `node scripts/compare-schema-inventory.mjs baseline.json observed.json`.
   Exit 0 means no differences in the inspected fields; exit 1 reports missing,
   extra and changed catalog object names; exit 2 means invalid input. An empty
   inventory, duplicate object, unknown field and overly large input are rejected.

The output compares relation type/RLS flags, column types and structural flags,
constraint and index definition fingerprints, and non-internal trigger and
trigger-function fingerprints. It does not include customer rows or roles.
Different PostgreSQL versions or formatting can generate false differences.
Matching output is **not** proof of schema equivalence or safety: it omits
permissions, grants, role inheritance, view and function bodies except trigger
function fingerprints, full default expressions, other schemas, data contents,
replicas, migrations, writers and backup state. Any unknown object, unreadable
catalog, unexpected mismatch, or unreviewed privileged function is a stop
condition. Do not repair production by copying a synthetic baseline's migrations.
