# Feature update and next version

## Features

1. [] Support multiple jira domains
   Some people work on multiple different jira domain eg: `appointy.atlassian.net` and `mathnasium.atlassian.net` and they want to sync from all domain task.
   Add a extra field in the setup page to add multiple jira domain.

2. [] When user install the extension, he should be redirected to setup page automatically.
   Currently, user need to click on the extension icon and click on setup button.

3. [In progress] Change the setup page design, extension pop up ui it looks like ai slop. Use frontend skills
   Update the favicon icon also in setup page

4. [] The user should able to open the jira task in jira board directly from the calendar(calendar will redirect the user to jira board)
   Add a redirect link to the event pop up box.
   Add it next to Jira status btn
   Format:
   Jira Status: Done </justify between> </Redirect Btn Logo>

## Changes

1. [] The jira status(label) shown when user click on linked event as low visibility as the color is light. Increase the contrast.
   Dark mode: it should be white text color
   Light mode: it should be black text color

2. [] When user create a new event, and start typing it the suggestion came. This not great enough.
   But i want even when user not clicked. List of jira task should be visible.
   Some time user do not remember exact name for jira task.

3. [] The task sync refresh occur in some fixed interval currently, there is no visibility on when that sync run last time.
   So whenever sync is run so the time also when sync run last time should be visible.
   Add it below `Sync Tasks Now` Btn

4. [] In log time. Add extra description to btns Log Time and Reset Worklog which is shown on hover about what it does
