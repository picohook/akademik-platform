-- Demo seed: one tenant, one reader, one work, one asset.
-- Replace with real publisher content only after written permission.

-- RLS is FORCEd on tenant tables; set the demo tenant for inserts.
select set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', false);

insert into tenants (id, name, slug, status)
values ('11111111-1111-1111-1111-111111111111', 'Demo Üniversitesi', 'demo-universitesi', 'active')
on conflict (id) do nothing;

insert into users (id, tenant_id, email, display_name, role, password_hash)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'reader@example.edu.tr', 'Demo Okuyucu', 'reader',
        'scrypt$8a902e4df4422ec1c41787ca6b7e9405$b3feb3659d89ab122f020c7cb35366d4d6170ee3b4c3f99e739ad338a6fc2e743e5301660090079291d7409a67bc2dc2c4f5870b346b0dd95b13cd5dd0b9d876')
on conflict (tenant_id, email) do nothing;

insert into users (id, tenant_id, email, display_name, role, password_hash)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
        'librarian@example.edu.tr', 'Demo Kütüphaneci', 'librarian',
        'scrypt$8a902e4df4422ec1c41787ca6b7e9405$b3feb3659d89ab122f020c7cb35366d4d6170ee3b4c3f99e739ad338a6fc2e743e5301660090079291d7409a67bc2dc2c4f5870b346b0dd95b13cd5dd0b9d876')
on conflict (tenant_id, email) do nothing;

insert into works (id, tenant_id, content_type, title, subtitle, language, abstract, subjects, metadata)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
        'monograph',
        'Demo PDF — Dummy PDF file',
        'One-page English test document',
        'en',
        'One-page English PDF used to verify reader, search, download and accessibility flows.',
        array['Demo', 'Platform testing'],
        '{"sample": true, "demo_fixture": true, "source_note": "one-page English test PDF"}'::jsonb)
on conflict (id) do nothing;

insert into editions (id, tenant_id, work_id, publisher, publication_year, edition, isbn13, license_uri, license_note, rights_note)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333',
        'Academic Platform test fixture', null, 'Test fixture', null,
        null,
        'Internal one-page demo fixture; not a publication.',
        'For platform testing only; not scholarly content.')
on conflict (id) do nothing;

insert into assets (id, tenant_id, edition_id, format, storage_key, page_count, text_content, quality_score, access_status)
values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444', 'pdf', 'seed/sample.pdf', 1,
        'Dummy PDF file',
        80, 'open')
on conflict (id) do nothing;

insert into collections (id, tenant_id, title, slug, description, visibility)
values ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
        'Demo', 'demo', 'One-page English test document for platform checks.', 'tenant')
on conflict (tenant_id, slug) do nothing;

insert into collection_items (collection_id, work_id, position)
values ('66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 1)
on conflict do nothing;

insert into grants (id, tenant_id, subject_type, subject_id, scope_type, source, status, valid_from, valid_to)
values ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
        'tenant', '11111111-1111-1111-1111-111111111111', 'all', 'trial', 'active', now(), now() + interval '90 days')
on conflict (id) do nothing;
