-- 003 — demo librarian account for upload/metadata tests.
-- Login: librarian@example.edu.tr / demo1234
-- Requires 002-users-password.sql first.

select set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', false);

insert into users (id, tenant_id, email, display_name, role, password_hash)
values (
  '44444444-4444-4444-4444-444444444444',
  '11111111-1111-1111-1111-111111111111',
  'librarian@example.edu.tr',
  'Demo Kütüphaneci',
  'librarian',
  'scrypt$8a902e4df4422ec1c41787ca6b7e9405$b3feb3659d89ab122f020c7cb35366d4d6170ee3b4c3f99e739ad338a6fc2e743e5301660090079291d7409a67bc2dc2c4f5870b346b0dd95b13cd5dd0b9d876'
)
on conflict (tenant_id, email) do nothing;
