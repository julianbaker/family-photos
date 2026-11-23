#!/bin/sh
# Family fork: rehearse switching a stock Immich v3.4.2 database to the fork.
# Uses throwaway containers on this machine only. Never point it at a production server.
#
#   family/rehearsal/rehearse.sh <immich-db-backup.sql.gz> <admin email> ["Family name"] [prod db user]
#   MEMBERS="cousin@example.com:member,gran@example.com:viewer"  existing accounts to add (optional)
#
# 1. restores the dump into a fresh Postgres (same image as stock Immich)
# 2. records what the old server has: photos, named people, birth dates, face assignments
# 3. starts the fork image (SERVER_IMAGE, default family-photos-server:dev), which runs its migrations
# 4. runs `immich-admin family-setup`
# 5. checks nothing was lost and prints a report; exits non-zero if a check fails
# Set KEEP=1 to leave the containers running afterwards (http://127.0.0.1:22830).
set -eu

DUMP="${1:?path to an immich-db-backup .sql.gz}"
EMAIL="${2:?email of the server admin who becomes the family admin}"
NAME="${3:-Family}"
OWNER="${4:-postgres}"
cd "$(dirname "$0")"
export SERVER_IMAGE="${SERVER_IMAGE:-family-photos-server:dev}"

compose() { docker compose "$@"; }
sql() { compose exec -T database psql -U postgres -d immich -At -v ON_ERROR_STOP=1 -c "$1"; }
cleanup() { if [ "${KEEP:-0}" != "1" ]; then compose down -v >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT

echo "== Starting a fresh database"
compose down -v >/dev/null 2>&1 || true
compose up -d database redis >/dev/null
until compose exec -T database pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2

echo "== Restoring $DUMP"
gunzip -c "$DUMP" \
  | sed -e "s/OWNER TO \"\?$OWNER\"\?;/OWNER TO postgres;/" \
  | compose exec -T database psql -U postgres -d immich -q --single-transaction -v ON_ERROR_STOP=1 >/dev/null

ADMIN_ID=$(sql "select id from \"user\" where email = '$EMAIL'")
[ -n "$ADMIN_ID" ] || { echo "No user with the email $EMAIL in the dump"; exit 1; }

# fingerprints of what must survive
before_assets=$(sql "select count(*) from asset where \"ownerId\" = '$ADMIN_ID' and \"deletedAt\" is null")
before_named=$(sql "select count(*) from person where \"ownerId\" = '$ADMIN_ID' and name != ''")
before_birth=$(sql "select count(*) from person where \"ownerId\" = '$ADMIN_ID' and \"birthDate\" is not null")
before_names=$(sql "select md5(coalesce(string_agg(\"personGroupId\"::text || name || coalesce(\"birthDate\"::text, ''), ',' order by \"personGroupId\"), '')) from person where \"ownerId\" = '$ADMIN_ID' and name != ''")
before_faces=$(sql "select md5(coalesce(string_agg(id::text || coalesce(\"personGroupId\"::text, '-'), ',' order by id), '')) from asset_face where \"deletedAt\" is null")
echo "   old server: $before_assets photos for the admin, $before_named named people ($before_birth with birth dates)"

echo "== Starting the fork ($SERVER_IMAGE); it runs the family migrations"
compose up -d server >/dev/null
i=0
until curl -s -m 2 http://127.0.0.1:22830/api/server/ping | grep -q pong; do
  i=$((i + 1)); [ $i -lt 120 ] || { compose logs --tail 40 server; echo "Server did not start"; exit 1; }
  sleep 2
done
echo "   migrations: $(sql "select string_agg(name, ', ' order by name) from kysely_migrations where name like '%Family%'")"

echo "== immich-admin family-setup"
compose exec -T server immich-admin family-setup --email "$EMAIL" --name "$NAME" | tee report.json.tmp
REPORT=$(cat report.json.tmp); rm -f report.json.tmp
field() { echo "$REPORT" | python3 -c "import sys,json; print(json.load(sys.stdin)['$1'])"; }

after_names=$(sql "select md5(coalesce(string_agg(fp.\"personGroupId\"::text || fp.name || coalesce(fp.\"birthDate\"::text, ''), ',' order by fp.\"personGroupId\"), '')) from family_person fp where fp.name != '' and fp.\"personGroupId\" in (select \"personGroupId\" from person where \"ownerId\" = '$ADMIN_ID' and name != '')")
after_faces=$(sql "select md5(coalesce(string_agg(id::text || coalesce(\"personGroupId\"::text, '-'), ',' order by id), '')) from asset_face where \"deletedAt\" is null")
admin_names=$(sql "select count(*) from person where \"ownerId\" = '$ADMIN_ID' and name != ''")

failed=0
check() { if [ "$2" = "$3" ]; then echo "   PASS $1"; else echo "   FAIL $1 (expected $2, got $3)"; failed=1; fi; }
echo "== Checks"
check "every photo is in the family library" "$before_assets" "$(field assets)"
check "named people became family people" "$before_named" "$(field namedPeople)"
check "birth dates kept" "$before_birth" "$(field peopleWithBirthDate)"
check "names and birth dates unchanged" "$before_names" "$after_names"
check "face assignments unchanged" "$before_faces" "$after_faces"
check "admin still sees the same names" "$before_named" "$admin_names"

for entry in $(echo "${MEMBERS:-}" | tr ',' ' '); do
  member_email="${entry%%:*}"; role="${entry#*:}"; [ "$role" = "$entry" ] && role=member
  member_id=$(sql "select id from \"user\" where email = '$member_email'")
  [ -n "$member_id" ] || { echo "   FAIL no user $member_email in the dump"; failed=1; continue; }
  member_groups=$(sql "select coalesce(string_agg(quote_literal(\"personGroupId\"), ','), 'null') from person where \"ownerId\" = '$member_id' and name != ''")
  member_names=$(sql "select md5(coalesce(string_agg(\"personGroupId\"::text || name, ',' order by \"personGroupId\"), '')) from person where \"ownerId\" = '$member_id' and name != ''")
  echo "== immich-admin family-add-member $member_email ($role)"
  compose exec -T server immich-admin family-add-member --email "$member_email" --role "$role" >/dev/null
  check "$member_email sees the admin's library" "1" "$(sql "select count(*) from partner where \"sharedById\" = '$ADMIN_ID' and \"sharedWithId\" = '$member_id' and \"inTimeline\"")"
  check "$member_email shares their library" "1" "$(sql "select count(*) from partner where \"sharedById\" = '$member_id' and \"sharedWithId\" = '$ADMIN_ID' and \"inTimeline\"")"
  check "$member_email has every family name" "$(sql "select count(*) from family_person where name != ''")" "$(sql "select count(*) from person p join family_person fp on fp.\"personGroupId\" = p.\"personGroupId\" where p.\"ownerId\" = '$member_id' and fp.name != ''")"
  check "$member_email kept their own names" "$member_names" "$(sql "select md5(coalesce(string_agg(fp.\"personGroupId\"::text || fp.name, ',' order by fp.\"personGroupId\"), '')) from family_person fp where fp.\"personGroupId\" in (select \"personGroupId\" from person where \"ownerId\" = '$member_id' and name != '' and \"personGroupId\" in ($member_groups))")"
done

if [ "$failed" = "0" ]; then echo "== Rehearsal passed"; else echo "== Rehearsal FAILED"; exit 1; fi
