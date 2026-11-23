-- Synthetic "production" data for the rehearsal, shaped like the real library: an admin whose
-- library is mostly an external library of scanned albums (1950s-1980s), ~300 people of whom ~60
-- are named, birth dates on some, and a second user with their own photos and people.
-- Run against a STOCK v3.4.2 database after the admin and the second user were created via the API.
\set ON_ERROR_STOP on
begin;

create temporary table seed_users as
  select (select id from "user" where email = 'admin@rehearsal.test') as admin_id,
         (select id from "user" where email = 'cousin@rehearsal.test') as cousin_id;

insert into library ("name", "ownerId", "importPaths", "exclusionPatterns")
select 'Scanned albums', admin_id, '{/mnt/nas/family-albums}', '{}' from seed_users;

-- 2,300 scanned photos in the external library, 1950-1989, two thirds with town-level GPS
insert into asset ("ownerId", "libraryId", "type", "originalPath", "originalFileName", "fileCreatedAt",
                   "fileModifiedAt", "localDateTime", "checksum", "checksumAlgorithm")
select u.admin_id, l.id, 'IMAGE', '/mnt/nas/family-albums/scan-' || g || '.jpg', 'scan-' || g || '.jpg',
       d, d, d, sha256(('scan' || g)::bytea), 'sha1-path'
from seed_users u, library l,
     generate_series(1, 2300) g,
     lateral (select timestamptz '1950-01-01' + (g * interval '1 day' * 5.7) as d) dates;

-- 166 phone uploads, 2015-2024
insert into asset ("ownerId", "type", "originalPath", "originalFileName", "fileCreatedAt", "fileModifiedAt",
                   "localDateTime", "checksum", "checksumAlgorithm")
select u.admin_id, 'IMAGE', '/data/upload/admin/IMG_' || g || '.HEIC', 'IMG_' || g || '.HEIC', d, d, d,
       sha256(('upload' || g)::bytea), 'sha1'
from seed_users u, generate_series(1, 166) g,
     lateral (select timestamptz '2015-01-01' + (g * interval '1 day' * 21) as d) dates;

-- the cousin's own 50 uploads
insert into asset ("ownerId", "type", "originalPath", "originalFileName", "fileCreatedAt", "fileModifiedAt",
                   "localDateTime", "checksum", "checksumAlgorithm")
select u.cousin_id, 'IMAGE', '/data/upload/cousin/IMG_' || g || '.JPG', 'IMG_' || g || '.JPG', d, d, d,
       sha256(('cousin' || g)::bytea), 'sha1'
from seed_users u, generate_series(1, 50) g,
     lateral (select timestamptz '2020-01-01' + (g * interval '1 day' * 30) as d) dates;

insert into asset_exif ("assetId", "description", "latitude", "longitude", "city", "country")
select a.id, '', case when n % 3 > 0 then 51.0 + (n % 50) / 100.0 end, case when n % 3 > 0 then -1.0 - (n % 40) / 100.0 end,
       case when n % 3 > 0 then 'Townsville' end, case when n % 3 > 0 then 'United Kingdom' end
from (select id, row_number() over (order by "fileCreatedAt") as n from asset) a;

-- the admin's ~300 people in the admin's cluster group: 60 named, 40 of them with birth dates
create temporary table admin_groups as
with groups as (
  insert into person_group ("clusterGroupId")
  select (select "clusterGroupId" from "user" where id = (select admin_id from seed_users))
  from generate_series(1, 300)
  returning id
)
select id, row_number() over () as n from groups;

insert into person ("ownerId", "personGroupId", "name", "birthDate")
select u.admin_id, g.id,
       case when g.n <= 60 then 'Relative ' || g.n else '' end,
       case when g.n <= 40 then date '1900-01-01' + (g.n::int * 600) end
from seed_users u, admin_groups g;

-- ~4,000 faces across the admin's photos; 10% not yet assigned to anyone
insert into asset_face ("assetId", "ownerId", "assetVisibility", "personGroupId", "boundingBoxX1", "boundingBoxY1",
                        "boundingBoxX2", "boundingBoxY2", "imageWidth", "imageHeight")
select a.id, a."ownerId", 'timeline', case when f % 10 = 0 then null else g.id end, 10, 10, 60, 60, 1000, 800
from (select id, "ownerId", row_number() over (order by id) as n from asset
      where "ownerId" = (select admin_id from seed_users)) a
cross join generate_series(1, 2) f
join admin_groups g on g.n = ((a.n * 7 + f * 13) % 300) + 1
where (a.n + f) % 5 != 0;

-- the cousin's own 10 people, 3 named, in the cousin's own cluster group
with groups as (
  insert into person_group ("clusterGroupId")
  select (select "clusterGroupId" from "user" where id = (select cousin_id from seed_users))
  from generate_series(1, 10)
  returning id
), numbered as (select id, row_number() over () as n from groups)
insert into person ("ownerId", "personGroupId", "name")
select u.cousin_id, n.id, case when n.n <= 3 then 'Cousin friend ' || n.n else '' end
from seed_users u, numbered n;

commit;

select 'assets' as what, count(*) from asset
union all select 'person groups', count(*) from person_group
union all select 'named people', count(*) from person where name != ''
union all select 'with birth date', count(*) from person where "birthDate" is not null
union all select 'faces', count(*) from asset_face;
