# Pre-Publish User Flow Checklist

1. Setup (new install):
   Open setup, add 1 domain, valid creds, select projects, sync, close.
   Repeat with 2+ domains.
   Try one invalid domain among valid ones and verify setup validation behavior.

2. Setup (edit existing config):
   Remove a domain, save, reopen extension.
   Add domain back, save, sync again.

3. Popup task sync:
   Open popup with all domains healthy.
   Click refresh projects and sync tasks.

4. Simulate one bad domain (wrong token/domain) and verify:
   healthy domains still list projects
   warning banner shows failed domain(s)
   sync still runs and reports failed domains.

5. Link event (full edit + bubble):
   Search and link issue from full edit.
   Search and link issue from event bubble.
   Multi-domain label formatting should include domain when needed.

6. Jira status + redirect:
   Bubble view: verify status shown, transitions work, redirect opens Jira.
   Full edit: verify status/redirect not shown (intended behavior).

7. Work log:
   Log for a day with linked completed events.
   Confirm ambiguous-key events are skipped with clear message.
   Confirm unconfigured-domain linked events are skipped.

8. Reset work log:
   Reset date with extension-created logs: verify deletion count.
   Reset date with no logs: verify “no logs found”.
   Multi-domain with one failing domain: verify partial-failure message includes failed domain(s).

9. Linked stale domain scenario:
   Link event to domain A, then remove domain A from setup.
   Reopen event and verify warning to reconfigure/relink.

10. Cache behavior:
    After sync, open event linking popover and confirm suggestions appear.
    With stale/empty cache, confirm background revalidation behavior and messaging.

11. Migration sanity:
    Upgrade from old single-domain persisted config and confirm:
    setup/popup still load
    existing linked events still parse
    worklog/reset still function.
