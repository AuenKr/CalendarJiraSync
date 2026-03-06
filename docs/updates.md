# Feature update and next version

## Features

1. [Require more thoughts and understanding of this flow need to get an account which have multiple jira accounts] Support multiple jira domains/instance.
   Some people work on multiple different jira domain eg: `appointy.atlassian.net` and `mathnasium.atlassian.net` and they want to sync from all domain task.
   Since same account is connected to multiple jira instance, the same api token will work on all jira instance for that account.
   Add a extra field(plus btn to add more jira domains) in the setup page to add multiple jira domain.
   This will change a lot of things in the code.
   - Syncing the task from all domain
   - matching task and domain properly
   - redirect btn
   - fetching task status
   - work log
   - reset work log
   - run sync task
   - where ever the jira task is added you have to add domain thing also(to link task + domain) find it.
   - Make a good working solution which is architecture good not just some hotfix.

2. [DONE] When user install the extension, he should be redirected to setup page automatically.
   Currently, user need to click on the extension icon and click on setup button.

3. [DONE] Change the setup page design, extension pop up ui it looks like ai slop. Use frontend skills
   Update the favicon icon also in setup page

4. [Done] The user should able to open the jira task in jira board directly from the calendar(calendar will redirect the user to jira board)
   Add a redirect link to the event pop up box.
   Add it next to Jira status btn
   Format:
   Jira Status: Done </justify between> </Redirect Btn Logo>

## Changes

1. [DONE] The jira status(label) shown when user click on linked event as low visibility as the color is light. Increase the contrast.
   Dark mode: it should be white text color
   Light mode: it should be black text color

2. [DONE] When user create a new event, and start typing it the suggestion from jira task is shown. This not great enough.
   But i want when user open to create event, it should show the jira suggestion. List of jira task should be visible.
   Some time user do not remember exact name for jira task.

3. [DONE] The task sync refresh occur in some fixed interval currently, there is no visibility on when that sync run last time.
   So whenever sync is run so the time also when sync run last time should be visible.
   Add it below `Sync Tasks Now` Btn

4. [DONE] In log time. Add extra description to btns Log Time and Reset Worklog which is shown on hover about what it does

## Bugs

1. [DONE] The sync task caching not working.
   Rename run sync now to sync jira task now
   remove live sync on top of pop page

2. [Not fixed] overflow layering scenario.
   When space in calendar is less and event box is open. The jira suggestion get overwritten by google calendar titles.
   Example: When i try to create an event on Saturday. Some tags overlay on each other
   See in the attached image

   Overflow works fine but issue occur when event title is empty and user click on the link jira task.
   This breaks the ui. for some reason event popup get disappear not event is created.
   Error in extension logs:
   [Jira Sync][ContentApp] Step failed: description focus lock failed
   Context
   <https://calendar.google.com/calendar/u/0/r/week/2026/2/22>

3. [DONE] Date Picker reopens when u click on date filed when date picker is already open.
   Either is should close or Remain open
   I prefer to close it.
