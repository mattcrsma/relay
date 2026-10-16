# Relay

A Chrome extension that reviews your assigned SharePoint cases, checks their RPD and Salesforce conversations, and sends a structured case review to Microsoft Teams through Power Automate.

**Status: working preview · Manifest V3 · No AI**

Relay is under active development. This snapshot captures the current workflow; improvements will be added as live testing continues. It is tailored to the configured FactSet sites and their page structure, rather than a general-purpose case management extension.

## What it does

- Starts with cases assigned to your exact full name in SharePoint's **AM Assignee** column, including shared assignments.
- Reads available case messages and classifies each case using its latest verified author and timestamp.
- Includes direct related cases found in SharePoint comments, RPD linked/duplicate properties, and Salesforce's Case RPDs section. It does not recursively follow every related case.
- Reuses matching tabs, or opens a new foreground tab when needed.
- Refreshes each selected SharePoint, RPD, or Salesforce tab before reading. It verifies that Chrome replaced the document and waits for page content to become ready.
- Expands and scrolls Salesforce feeds to collect available messages.
- Recognizes the current RPD **Resolved** status as finished.
- Sends linked HTML tables to Teams, showing readable Salesforce case numbers when available.
- Provides a light/dark interface, run progress, cancellation, report copying, and case-history export.

Relay does not post case replies, change assignments, resolve tickets, or remove SharePoint entries. You manage those changes yourself.

## Classification

Rules are applied in this order:

| Condition | Result |
| --- | --- |
| Current RPD status is Resolved | Finished, included in **Recently Handled** |
| Latest message cannot be verified | **Unclassified**, with a reason for manual checking |
| Latest author is identified as a client | **Likely Needs Attention**, marked immediate |
| Latest author is outside your configured team | **Likely Needs Attention** |
| You or a teammate replied last, at least 7 days ago | **Stale / Follow-up (7+ days)** |
| You replied last, fewer than 7 days ago | **Recently Handled** |
| A teammate replied last, fewer than 7 days ago | **Waiting on Others** |

Public/internal visibility alone does not determine the author's identity. A teammate's public comment is still a team reply. Main cases and related cases are assessed independently.

## Installation

Requirements:

- Chrome 120 or later, with permission to load an unpacked extension.
- Signed-in access to the relevant SharePoint list, RPD, and Salesforce.
- A Power Automate HTTP-triggered flow for Teams notifications, if you want to send reports.

1. Clone this repository, or download and extract its ZIP.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the folder containing `manifest.json`.
5. Pin **Relay**, then open its **Settings**.

No build step or package installation is required. A simple placeholder icon is included at `images/relay.png`. Replace it with your own Relay PNG to use it for both the extension and popup.

## Configure your account

In Settings:

1. Enter your **SharePoint / RPD Full Name** exactly as it appears in AM Assignee.
2. Enter your **Salesforce Author Alias**, if applicable.
3. Add each teammate's full name and alias. Optional email and employee ID fields can improve identity matching.
4. Paste your complete **Power Automate HTTP URL** if using notifications.
5. Save, then use **Send Test Report** to check delivery.

This repository has blank personal defaults. No personal roster or webhook URL is included. Existing settings are read from the current extension's local storage; a separately installed copy may require configuration again.

The stale threshold is currently fixed at seven days. Monitoring is started manually.

## Run a review

1. Open your populated SharePoint case list and show the AM Assignee column.
2. If multiple SharePoint lists are open, make the intended list active.
3. Open Relay and choose **Run Relay Now**.
4. Select a run mode:

| Mode | Notification behavior |
| --- | --- |
| **Run + Send Report** | Sends all four classification sections, including empty sections. Requires a configured HTTP URL. |
| **Run Only** | Sends only Needs Attention and Stale sections when either contains cases and a URL is configured. Without a URL, the results remain local. |

Unclassified cases and reading warnings are included where applicable. **Run Only can still send a notification** when actionable cases are found.

Relay activates case tabs while working. It closes only tabs it created for the run, retaining reused tabs. It does not create tab groups.

Use **Stop Monitor** to request cancellation. Work already saved remains available. Cancellation cannot recall a report that has already been transmitted.

## Power Automate setup

Use an HTTP request trigger with an object schema accepting at least:

```json
{
  "type": "object",
  "properties": {
    "message": { "type": "string" },
    "messageHtml": { "type": "string" },
    "htmlReports": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

Additional legacy fields may remain in your schema.

1. Add **Apply to each**, using this expression:

   ```text
   triggerBody()?['htmlReports']
   ```

2. Inside that loop, add the Teams **Post message in a chat or channel** action.
3. Choose your destination and posting identity.
4. Set its Message field through the Expression tab to:

   ```text
   item()
   ```

5. Keep loop concurrency off to preserve report order.
6. Remove any separate old posting action that would duplicate the report.

The Teams action should receive the HTML string directly. Do not wrap `triggerBody()?['message']` inside the loop: that posts the plain-text fallback repeatedly instead of the HTML tables.

Save the flow and paste its full HTTP trigger URL into Relay Settings. A successful HTTP response confirms that the request was accepted; check Teams and the flow run history to verify final delivery.

## Project files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension metadata, permissions, and supported hosts |
| `background.js` | Settings defaults, run queue, tab refresh, reporting, and delivery |
| `common.js` | Shared parsing, identity matching, and classification |
| `sharepoint.js` | Assignment list and comment reader |
| `rpd.js` | RPD conversation, current status, and related-case reader |
| `salesforce.js` | Salesforce feed and related-RPD reader |
| `popup.html`, `popup.js` | Run controls and progress |
| `options.html`, `options.js` | Identity, team, theme, and notification settings |
| `style.css` | Shared interface styles |
| `images/relay.png` | Extension and popup icon |

Defaults are part of `background.js`; there is no separate `defaults.js` file.

## Data and permissions

Settings, run checkpoints, collected messages, and results are stored in `chrome.storage.local`. Reports are sent to your configured Power Automate endpoint when the chosen run mode calls for delivery. This version has no AI integration or analytics service.

| Permission | Use |
| --- | --- |
| `storage` | Save settings, run state, and results |
| `unlimitedStorage` | Retain collected case history locally |
| `tabs` | Locate, activate, refresh, create, and clean up case tabs |
| `scripting` | Run readers on supported pages |
| `alarms` | Resume an interrupted manually started run |

Host permissions cover the configured SharePoint, RPD, Salesforce, and supported Power Automate hosts. The recovery alarm does not schedule recurring case reviews.

Keep webhook URLs, exported case histories, screenshots, client conversations, and personal settings out of commits. The included `.gitignore` excludes common export and secret filenames, but cannot identify every sensitive file automatically.

## Known limitations

- Page readers depend on the current DOM structure and can require updates when the sites change.
- Some nested Salesforce replies cannot yet be verified and are reported as unclassified.
- Matching is based on configured names, aliases, emails, and IDs, not fuzzy name guesses.
- RPD Resolved status is handled explicitly; equivalent Salesforce closed-status handling is not yet implemented.
- Refresh verification confirms a new document and ready content. It cannot guarantee that an upstream service has finished propagating every change.
- Long histories and dynamic loading may hit scan limits; inspect the warnings.
- Report dates currently use UTC+8.
- HTML spacing and table layout can vary between Teams clients.
- The current build has not been published to the Chrome Web Store.

## Development and updates

Edit the source files, reload the extension in `chrome://extensions`, and start a fresh run. Keep the same extension installation when possible to retain local settings.

Before publishing a change, check the JavaScript syntax, confirm that only the intended SharePoint assignments enter the run, and review a sample of RPD and Salesforce results against the visible case messages. Use **Send Test Report** to verify your flow separately from case reading.

Planned follow-up work:

- Improve nested Salesforce reply verification and loading diagnostics.
- Refine report readability and table spacing.
- Add regression fixtures using synthetic or redacted case markup.
- Revisit broader closed-case handling.
- Explore an AI-assisted case knowledge project separately from this deterministic monitor.

No AI features are implemented in this snapshot.
