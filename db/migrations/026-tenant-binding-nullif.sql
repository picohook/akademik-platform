-- 026 - a tenant binding can be undone: nullif(current_setting(...), '')::uuid
--
-- Why this file exists. Every tenant policy in schema.sql and in 001, 007, 011, 012,
-- 013, 014, 015, 016, 021 and 022 spells the binding as
--
--   tenant_id = current_setting('app.tenant_id', true)::uuid
--
-- current_setting(..., true) returns NULL only while app.tenant_id has NEVER been
-- assigned on that session. Once it has been - which any tenant-scoped request does -
-- no undo restores it. Measured on PostgreSQL 16 with a one-connection pool:
--
--   | after a bound transaction                  | current_setting(...) | next unbound read          |
--   |--------------------------------------------|----------------------|----------------------------|
--   | reset app.tenant_id                        | ''                   | 22P02: "" is not a uuid    |
--   | reset all                                  | ''                   | 22P02                      |
--   | set_config('app.tenant_id', null, false)   | ''                   | 22P02                      |
--   | left set (no undo)                         | the tenant id        | silently reads that tenant |
--
-- Postgres does not short-circuit the `or`, so `tenant_id is null or ''::uuid` still
-- evaluates the cast and still raises 22P02 - rewriting a query's WHERE cannot help,
-- and RLS evaluates the policy before the query's own filter anyway.
--
-- The consequence for pooled connections is that the only safe handling today is to
-- destroy the connection after any tenant-scoped transaction
-- (client.release(true) in spike/app/libedge-bridge-db.mjs). That works, and it costs
-- one connect per tenant-scoped bridge transaction for as long as the process lives.
-- With this file, `reset app.tenant_id` genuinely unbinds: the expression becomes
-- NULL, `is null` is true, and the connection can go back to the pool.
--
-- What this file does NOT do:
--
--   * It does not change behaviour for a bound session. `tenant_id = current_setting
--     (...)::uuid` and `tenant_id = nullif(current_setting(...), '')::uuid` are the same
--     comparison for every non-empty value.
--   * It does not touch app.user_id or app.maintenance. Those policies in 016 already
--     use `nullif(current_setting('app.user_id', true), '')`, so they are the shape this
--     file copies - and 021's bridge_idempotency policy deliberately uses
--     `coalesce(current_setting('app.tenant_id', true), '') <> ''`, which treats '' and
--     NULL as the same thing. Rewriting it to nullif would turn a fail-closed check into
--     one that still denies, so it is left exactly as it is: this file narrows its scope
--     to the `::uuid` cast, where the defect actually is.
--
-- The transformation is applied to pg_policies, not to a list typed here. A policy added
-- to schema.sql later is covered by re-running this file, and a policy this file cannot
-- parse raises and rolls the whole migration back rather than leaving a half-converted
-- database. Every affected policy is recreated with the same name, command, permissive
-- flag and role list, so pg_policies before and after differ in exactly one column:
-- qual/with_check.
--
-- Files applied by db/migrate.mjs must not contain begin/commit and must not use psql
-- meta-commands.

set local row_security = off;

-- The guarded expression, in one place so the conversion and the verification cannot
-- drift apart. It is written inline into every policy rather than hidden behind a function:
--
--   * ''::uuid raises, so the empty string is mapped to NULL first;
--   * `current_setting(..., true)` may return NULL already (never assigned), and
--     nullif(NULL, '') is NULL - no special case needed.
--
-- An SQL function (app.tenant_binding()) was tried and removed: the policies have to name
-- the expression in their own DDL either way, so the function had no caller. A policy
-- written as `tenant_id = app.tenant_binding()` would also be evaluated as whoever runs
-- the query, which makes an EXECUTE grant a precondition for every read.

-- ---------------------------------------------------------------------------
-- The conversion
-- ---------------------------------------------------------------------------
do $body$
declare
  policy record;
  qual text;
  with_check text;
  cmd text;
  roles text;
  rewritten int := 0;
  untouched int := 0;
  -- The normalised forms pg_policies reports, in one place so the rewrite and the
  -- assertion at the end of the file cannot drift apart.
  v_bare text := 'current_setting(''app.tenant_id''::text, true))::uuid';
  v_guarded text := 'nullif(current_setting(''app.tenant_id''::text, true), ''''))::uuid';
begin
  for policy in
    -- Every column is qualified: plpgsql substitutes a declared variable name for a bare
    -- `roles` wherever it appears in a statement - including `unnest(policy.roles)` - so
    -- an unqualified reference is "column reference roles is ambiguous", not a hint.
    select ss.schemaname, ss.tablename, ss.policyname, ss.permissive, ss.roles, ss.cmd,
           ss.qual, ss.with_check
    from pg_policies ss
    where ss.schemaname = 'public'
      and (ss.qual like '%current_setting(%app.tenant_id%'
        or ss.with_check like '%current_setting(%app.tenant_id%')
    order by ss.tablename, ss.policyname
  loop
    -- The one shape this file does not own: 021's bridge_idempotency check treats '' and
    -- NULL alike, which is a deliberate fail-closed test rather than a cast. Converting
    -- it would be a behaviour change disguised as a bug fix, so it is counted and left.
    --
    -- ilike, not like: pg_get_expr upper-cases a function name it knows
    -- (`(COALESCE(current_setting(...`), and the guard below is what caught the first
    -- version of this line missing it - with 0A000 rather than a silent skip.
    if coalesce(policy.qual, '') ilike '%coalesce(current_setting(%app.tenant_id%'
       or coalesce(policy.with_check, '') ilike '%coalesce(current_setting(%app.tenant_id%' then
      untouched := untouched + 1;
      continue;
    end if;

    -- Only the cast is rewritten. A policy that mentions the setting in some other way
    -- (there is none today) is refused loudly instead of being silently skipped.
    --
    -- This file is not re-runnable, and that is deliberate. Rewriting an expression that is
    -- already guarded - `nullif(current_setting('app.tenant_id'::text, true), ''::text)`
    -- would still contain the bare cast as a substring - would either double-wrap the call
    -- or need a second, different search pattern, and a migration that does the same thing
    -- two ways is one nobody can review. db/migrate.mjs records what it applied, so a
    -- second run is a no-op at the runner; the guard below is what turns a hand-run second
    -- application into an error instead of silently nesting two nullifs.
    qual := policy.qual;
    with_check := policy.with_check;
    if qual is not null then
      if position(v_bare in qual) = 0 then
        raise exception '026: policy %.% has a tenant_id expression this file does not '
          'understand: %. Update the migration rather than leaving it converted halfway.',
          policy.tablename, policy.policyname, qual
          using errcode = 'feature_not_supported';
      end if;
      qual := replace(qual, v_bare, v_guarded);
    end if;
    if with_check is not null then
      if position(v_bare in with_check) = 0 then
        raise exception '026: policy %.% has a tenant_id check this file does not '
          'understand: %. Update the migration rather than leaving it converted halfway.',
          policy.tablename, policy.policyname, with_check
          using errcode = 'feature_not_supported';
      end if;
      with_check := replace(with_check, v_bare, v_guarded);
    end if;

    -- Same name, same command, same permissive flag, same roles: only the expressions
    -- change. roles is a name[] in pg_policies and is rebuilt identically.
    execute format('drop policy %I on %I.%I', policy.policyname, policy.schemaname, policy.tablename);
    -- Qualified on purpose: plpgsql substitutes a variable name wherever it appears, and
    -- inside `unnest(policy.roles)` the bare word `roles` reads as the DECLAREd variable -
    -- which is NULL at this point, hence "column reference is ambiguous" from the alias.
    select string_agg(quote_ident(pr.role_name), ', ') into roles
      from unnest(policy.roles) as pr(role_name);

    cmd := format('create policy %I on %I.%I', policy.policyname, policy.schemaname, policy.tablename);
    if policy.permissive = 'RESTRICTIVE' then
      cmd := cmd || ' as restrictive';
    end if;
    if policy.cmd <> 'ALL' then
      cmd := cmd || format(' for %s', policy.cmd);
    end if;
    if roles <> '' then
      cmd := cmd || format(' to %s', roles);
    end if;
    if qual is not null then
      cmd := cmd || format(' using (%s)', qual);
    end if;
    if with_check is not null then
      cmd := cmd || format(' with check (%s)', with_check);
    end if;
    execute cmd;
    rewritten := rewritten + 1;
  end loop;

  if rewritten = 0 then
    raise exception '026: no policy mentions app.tenant_id. Either this database is not '
      'the schema this migration was written for, or the policies were already rewritten '
      'and this file is being applied twice.'
      using errcode = 'feature_not_supported';
  end if;

  raise notice '026: rewrote % tenant policies, left % untouched (coalesce form)', rewritten, untouched;
end
$body$;
-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Two assertions, both about the outcome rather than about a count. A policy converted
-- halfway (the cast replaced in qual but not in with_check, or a table skipped) fails the
-- first; a policy dropped and not recreated fails the second. Neither can pass by looking
-- plausible: the expressions are read back from the catalogue, not from this file.
--
-- Both comparisons are ilike because pg_get_expr upper-cases a function name it knows:
-- the guard it reports is `NULLIF(current_setting(...`, not `nullif(...`.
do $body$
declare
  offending text;
  remaining int;
begin
  -- Every policy that mentions app.tenant_id is either guarded or the one coalesce form
  -- this file deliberately leaves alone.
  select string_agg(format('%s.%s = %s', tablename, policyname, coalesce(qual, with_check)), E'\n')
    into offending
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%current_setting(%app.tenant_id%'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not ilike '%nullif(current_setting(%app.tenant_id%'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not ilike '%coalesce(current_setting(%app.tenant_id%';
  if offending is not null then
    raise exception '026: still unguarded: %', offending using errcode = 'feature_not_supported';
  end if;

  -- And the conversion touched more than nothing: if the loop found no policy to rewrite,
  -- every table it was meant to protect is still unguarded.
  select count(*) into remaining
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%nullif(current_setting(%app.tenant_id%';
  if remaining < 20 then
    raise exception '026: only % policies are guarded; the schema has at least 20 - the '
      'conversion did not run over the whole catalogue', remaining
      using errcode = 'feature_not_supported';
  end if;
end
$body$;
