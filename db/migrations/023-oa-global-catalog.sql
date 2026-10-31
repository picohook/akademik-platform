-- 023 - initial LibEdge open-access catalogue move (contract section 4.4)
--
-- One transaction is owned by db/migrate.mjs. This file contains no begin/commit.
-- The work allowlist is explicit; no title/slug matching is used. A wrong starting
-- state raises before the first mutation.

set local row_security = off;

do $oa$
declare
  staff_tenant constant uuid := '5799f2a5-3d90-41b1-90de-9da07d776052';
  individual_tenant constant uuid := 'b2c00000-0000-4000-8000-000000000001';
  individual_grant constant uuid := 'b2c00000-0000-4000-8000-000000000002';
  oa_collection constant uuid := '74149e93-39dd-50ba-b120-a75415d9b0ca';
  demo_work constant uuid := '33333333-3333-3333-3333-333333333333';
  demo_collection constant uuid := '66666666-6666-6666-6666-666666666666';
  allowed_ids constant uuid[] := array[
    '0de0fa03-a7ba-5500-87a2-c5010ec90c8f',
    'ade89757-a148-5875-90b5-3f7f88e3e39b',
    'ccfbdb6f-631c-51a5-bd04-c6f4657ee438',
    'b778e968-77cc-5400-bd90-3adc0de7a4bb',
    '5a60cea2-1fa1-5b53-9184-f6a2497e4aff',
    '1a599a2b-51c8-5a2e-91cf-9d3ce76684f2',
    '7253cf24-606a-5fa2-8da1-2b565574d7f6',
    '0e2bade7-25e3-519f-82e7-e807d84d2b11',
    'f4797188-83fd-5737-8185-fb957cfaf77c',
    '583e6756-d3b0-52e7-8017-07f85fa5f0f5',
    'c94c49ac-6c24-40eb-8f3d-2dd88774ba54',
    '63c7ec83-e77c-5dde-b805-14c0840d6cb2'
  ]::uuid[];
  found_count int;
  item_count int;
  changed int;
  v_work uuid;
begin
  if (select count(*) from tenants where id = staff_tenant) <> 1 then
    raise exception '023: source tenant % is missing', staff_tenant using errcode = 'P0001';
  end if;

  if exists (
    select 1 from tenants
     where id = staff_tenant
       and libedge_kind is not null
       and (libedge_kind <> 'staff' or libedge_ref <> 'libedge')
  ) then
    raise exception '023: source tenant already has a different LibEdge context'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from tenants where libedge_kind = 'staff' and id <> staff_tenant) then
    raise exception '023: another staff tenant exists' using errcode = 'P0001';
  end if;

  if exists (select 1 from tenants where libedge_kind = 'individual' or libedge_ref = 'b2c') then
    raise exception '023: an individual/b2c tenant already exists' using errcode = 'P0001';
  end if;

  if not exists (select 1 from collections where id = oa_collection and tenant_id = staff_tenant) then
    raise exception '023: OA collection % is missing or not staff-owned', oa_collection
      using errcode = 'P0001';
  end if;

  select count(*) into found_count from works where id = any(allowed_ids);
  if found_count <> 12 then
    raise exception '023: expected 12 source works, found %', found_count using errcode = 'P0001';
  end if;

  if (select count(distinct value) from unnest(allowed_ids) as value) <> 12 then
    raise exception '023: allowlist contains duplicate work IDs' using errcode = 'P0001';
  end if;

  if demo_work = any(allowed_ids) then
    raise exception '023: demo work must not be in the allowlist' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from works
     where id = any(allowed_ids)
       and tenant_id is distinct from staff_tenant
  ) then
    raise exception '023: an allowlisted work is not owned by the staff tenant'
      using errcode = 'P0001';
  end if;

  select count(*) into item_count from collection_items where collection_id = oa_collection;
  if item_count <> 12 then
    raise exception '023: OA collection must contain exactly 12 items, found %', item_count
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from collection_items
     where collection_id = oa_collection
       and work_id <> all(allowed_ids)
  ) then
    raise exception '023: OA collection contains a work outside the allowlist'
      using errcode = 'P0001';
  end if;

  if (select count(*) from collection_items
       where collection_id = oa_collection and work_id = any(allowed_ids)) <> 12 then
    raise exception '023: OA collection is missing an allowlisted work'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from collections where id = demo_collection and tenant_id is null) then
    raise exception '023: demo collection is already global' using errcode = 'P0001';
  end if;

  update tenants
     set libedge_kind = 'staff', libedge_ref = 'libedge'
   where id = staff_tenant;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception '023: source tenant was not mapped to staff/libedge' using errcode = 'P0001';
  end if;

  insert into tenants (id, name, slug, status, libedge_kind, libedge_ref)
  values (individual_tenant, 'LibEdge Individual', 'libedge-individual', 'active', 'individual', 'b2c');

  foreach v_work in array allowed_ids loop
    perform catalog_publish_work(v_work);
  end loop;

  update collections
     set tenant_id = null
   where id = oa_collection and tenant_id = staff_tenant;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception '023: OA collection was not moved to global scope' using errcode = 'P0001';
  end if;

  update collection_items
     set tenant_id = null
   where collection_id = oa_collection;
  get diagnostics changed = row_count;
  if changed <> 12 then
    raise exception '023: expected to move 12 collection items, moved %', changed
      using errcode = 'P0001';
  end if;

  if exists (select 1 from works where id = any(allowed_ids) and tenant_id is not null) then
    raise exception '023: an allowlisted work remained tenant-owned' using errcode = 'P0001';
  end if;

  if exists (select 1 from collection_items where collection_id = oa_collection and tenant_id is not null) then
    raise exception '023: an OA collection item remained tenant-owned' using errcode = 'P0001';
  end if;

  if (select count(*) from collection_items where collection_id = oa_collection) <> 12 then
    raise exception '023: OA collection no longer contains exactly 12 items' using errcode = 'P0001';
  end if;

  insert into grants (
    id, tenant_id, subject_type, subject_id, scope_type, scope_id,
    source, status, valid_from, valid_to
  ) values (
    individual_grant, individual_tenant, 'tenant', individual_tenant,
    'collection', oa_collection, 'subscription', 'active', now(), null
  );

  if exists (
    select 1 from grants
     where tenant_id = individual_tenant and scope_type = 'all'
  ) then
    raise exception '023: individual tenant received an all grant' using errcode = 'P0001';
  end if;
end
$oa$;


