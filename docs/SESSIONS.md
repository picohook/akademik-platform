# Sessions and seat limits

- Session cookie lasts 7 days, but **seat counting** only counts sessions seen in the last **2 hours** (`last_seen_at`). Closing a tab does not send a logout; stale rows are ignored for the limit after 2 hours and pruned after 7 days.
- `users.max_sessions` is the per-user limit (default 3). The grant `seat_limit` limits the whole tenant; the effective limit is the smaller one.
- Same-browser tabs share one session. Separate profiles/devices are separate sessions.

## Login says the limit is full but no tabs are open

Check the count and clear stale rows:

```powershell
docker compose exec db psql -U akademik -d akademik -c "select u.email, u.max_sessions, count(s.id) from users u left join user_sessions s on s.user_id = u.id group by u.email, u.max_sessions order by u.email;"
```

Clear one account:

```powershell
docker compose exec db psql -U akademik -d akademik -c "delete from user_sessions where user_id = (select id from users where email = 'librarian@example.edu.tr');"
```

Clear all sessions (all users must sign in again):

```powershell
docker compose exec db psql -U akademik -d akademik -c "delete from user_sessions;"
```

Then rebuild/restart the web image so the 2-hour active window is in effect:

```powershell
docker compose up -d --build
```
