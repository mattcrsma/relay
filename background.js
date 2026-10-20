importScripts('common.js');

const C = CM;
let busy = false;
let starting = false;
let deliveryController = null;

const defaults = {
  rpdName: 'Matthew Cuaresma',
  salesforceAlias: 'matth',
  powerAutomateUrl: '',
  myTeam: [
    { name: 'Yilin Zhu', ownerAlias: 'yilin' },
    { name: 'Michael Roxas', ownerAlias: 'micha' },
    { name: 'Alonso Luis Tecson', ownerAlias: 'alonso' },
    { name: 'Jhon Person Cabarles', ownerAlias: 'jperson' },
    { name: 'Angelee Bianca Calanog', ownerAlias: 'angelee' },
    { name: 'Johann Kenoses Caminsi', ownerAlias: '' },
    { name: 'Red Lucas', ownerAlias: 'josep' },
    { name: 'Matthew Cuaresma', ownerAlias: 'matth' },
    { name: 'Beverly Joyce Dequico', ownerAlias: 'bev' },
    { name: 'Ayan Jana', ownerAlias: 'ayanj' },
    { name: 'Thotla Shivani', ownerAlias: 'thotl' },
    { name: 'Yashwanth HM', ownerAlias: 'yashw' },
    { name: 'Sravan Kumar Reddy Kethireddy', ownerAlias: 'srava' },
    { name: 'Mohd Ghouse Mohiuddin', ownerAlias: '' },
    { name: 'Arudra Tarun Kumar Boddana', ownerAlias: 'arudr' },
    { name: 'Uma Mahesh Kummari', ownerAlias: '' },
    { name: 'Cindy Simbulan', ownerAlias: 'csimb' },
    { name: 'Kristenne Urielle Mercado', ownerAlias: 'krist' },
    { name: 'Anton Luis Perez', ownerAlias: 'anton' },
    { name: 'Francis Angelo Fundal', ownerAlias: 'franc' },
    { name: 'Robert Patrick Francisco', ownerAlias: 'pat' },
    { name: 'Dileep Sarana', ownerAlias: 'dilee' },
    { name: 'Divya', ownerAlias: '' },
    { name: 'Nilabhra Pal', ownerAlias: 'nilab' },
    { name: 'Khushboo Gandhi', ownerAlias: 'khush' },
    { name: 'Ankit A', ownerAlias: 'ankit' },
    { name: 'Niranjan Nitin Polekar', ownerAlias: 'niran' },
    { name: 'Krutik Shaligram Khandare', ownerAlias: 'kruti' },
    { name: 'Dharampalsinh', ownerAlias: '' },
    { name: 'Aniket Belavi', ownerAlias: 'anike' },
    { name: 'Kiran Santhosh', ownerAlias: 'kiran' },
    { name: 'Sweta Roy', ownerAlias: '' },
    { name: 'Ayan Biswas', ownerAlias: 'ayanb' },
    { name: 'Utkarsh Thorat', ownerAlias: '' },
    { name: 'Priyanka Issrani', ownerAlias: '' },
    { name: 'Anushka Keshri', ownerAlias: 'anush' },
    { name: 'Chandra Lekha M', ownerAlias: '' },
    { name: 'Shikara Reddy Singi Reddy', ownerAlias: 'shika' },
    { name: 'Bhavya Sinha', ownerAlias: 'bhavy' },
    { name: 'Sathya Prabhu', ownerAlias: '' }
  ]
};

let settingsMigration = null;

async function loadSettings() {
  if (!settingsMigration) {
    settingsMigration = (async () => {
      const saved = await chrome.storage.local.get({
        ...defaults,
        cmRoster20261014v1: false
      });

      if (!saved.cmRoster20261014v1) {
        const team = Array.isArray(saved.myTeam)
          ? saved.myTeam.map(person => ({ ...person }))
          : [];

        for (const person of defaults.myTeam) {
          const existing = team.find(member =>
            C.norm(member.name) === C.norm(person.name) ||
            (
              person.name === 'Ankit A' &&
              C.norm(member.name) === 'ankit'
            )
          );

          if (existing) {
            existing.name = person.name;

            if (person.ownerAlias) {
              existing.ownerAlias = person.ownerAlias;
            }
          } else {
            team.push({ ...person });
          }
        }

        const patch = {
          myTeam: team,
          cmRoster20261014v1: true
        };

        if (C.norm(saved.rpdName) === 'matthew cuaresma') {
          patch.salesforceAlias = 'matth';
        }

        await chrome.storage.local.set(patch);
      }
    })().catch(error => {
      settingsMigration = null;
      throw error;
    });
  }

  await settingsMigration;
  return chrome.storage.local.get(defaults);
}

const own = sender => {
  if (sender.id !== chrome.runtime.id || !sender.url) {
    return false;
  }

  try {
    const url = new URL(sender.url);
    url.search = '';
    url.hash = '';

    return ['popup.html', 'options.html'].some(
      page => url.href === chrome.runtime.getURL(page)
    );
  } catch {
    return false;
  }
};

const readJob = async () =>
  (await chrome.storage.local.get('cmJob')).cmJob;

async function saveJob(job, progress) {
  await chrome.storage.local.set({
    cmJob: job,
    monitorIsRunning: job.status === 'running',
    monitorProgress: progress || ''
  });
}

async function ready(tabId) {
  const end = Date.now() + 45000;

  while (Date.now() < end) {
    await C.cancelled();
    const tab = await chrome.tabs.get(tabId);

    if (tab.status === 'complete') return;

    await C.sleep(400);
  }

  throw new Error('Case page load timed out.');
}

async function reloadAndWait(tabId, site, refresh = true) {
  await C.cancelled();

  const tab = await chrome.tabs.get(tabId);

  await chrome.windows.update(tab.windowId, {
    focused: true
  });

  await chrome.tabs.update(tabId, {
    active: true
  });

  let oldDocumentId = null;

  if (refresh) {
    const [before] = await chrome.scripting.executeScript({
      target: { tabId },
      injectImmediately: true,
      func: () => document.readyState
    });

    oldDocumentId = before?.documentId;

    if (!oldDocumentId) {
      throw new Error('Cannot verify the page before refresh.');
    }
  }

  await chrome.storage.local.set({
    monitorProgress:
      `${refresh ? 'Refreshing' : 'Loading'} ${site}…`
  });

  if (refresh) {
    await chrome.tabs.reload(tabId, {
      bypassCache: true
    });
  }

  const started = Date.now();

  let stableDocument = '';
  let signature = '';
  let since = 0;
  let reason = 'waiting for page navigation';

  while (Date.now() - started < 180000) {
    await C.cancelled();

    const current = await chrome.tabs.get(tabId);
    let probe;

    if (current.status === 'complete') {
      try {
        [probe] = await chrome.scripting.executeScript({
          target: { tabId },
          injectImmediately: true,

          func: site => {
            const hosts = {
              SharePoint: 'factset.sharepoint.com',
              Salesforce: 'factset.lightning.force.com',
              RPD: 'rpd.factset.com'
            };

            if (
              location.hostname !== hosts[site] ||
              document.readyState !== 'complete'
            ) {
              return {
                ready: false,
                reason: 'waiting for navigation or sign-in'
              };
            }

            if (site === 'Salesforce') {
              // Salesforce's reader handles feed loading and activation.
              return {
                ready: !!document.body,
                signature: 'salesforce'
              };
            }

            if (site === 'RPD') {
              return {
                ready: !!document.querySelector(
                  '.reply [id^="msgContent_"]'
                ),
                signature: 'rpd',
                reason: 'waiting for the RPD thread'
              };
            }

            const visible = node =>
              !!node?.getClientRects().length &&
              getComputedStyle(node).visibility !== 'hidden';

            const list = document.querySelector('#list-content-id');

            const rows = list
              ? [...list.querySelectorAll(
                  '[role="row"][data-automationid^="row-"]'
                )].filter(row => {
                  const isDataRow = /^row-\d+$/.test(
                    row.getAttribute('data-automationid') || ''
                  );

                  // Check the rendered cells as well as the row wrapper.
                  const rendered =
                    visible(row) ||
                    [...row.querySelectorAll(
                      '[data-automationid^="field-"]'
                    )].some(cell =>
                      visible(cell) ||
                      [...cell.querySelectorAll('*')].some(visible)
                    );

                  return isDataRow && rendered;
                })
              : [];

            const ready =
              !!rows.length &&
              rows.every(row =>
                row.querySelector(
                  '[data-automationid="field-AMAssignee"]'
                ) &&
                row.querySelector(
                  '[data-automationid="field-LinkTitle"]'
                )
              ) &&
              !list.matches('[aria-busy="true"]') &&
              ![...list.querySelectorAll(
                '[aria-busy="true"],[role="progressbar"],.ms-Spinner'
              )].some(visible);

            return {
              ready,
              signature: rows.map(row =>
                row.getAttribute('data-automationid') +
                ':' +
                row.textContent.trim()
              ).join('|'),
              reason: ready
                ? 'waiting for rows to settle'
                : 'waiting for assignment rows'
            };
          },

          args: [site]
        });
      } catch (error) {
        reason = `waiting for page access: ${error.message}`;
      }
    }

    if (probe?.result?.reason) {
      reason = probe.result.reason;
    }

    if (
      !probe?.documentId ||
      probe.documentId === oldDocumentId ||
      !probe.result?.ready
    ) {
      since = 0;
    } else {
      const next = probe.result.signature || '';

      if (
        !since ||
        stableDocument !== probe.documentId ||
        signature !== next
      ) {
        stableDocument = probe.documentId;
        signature = next;
        since = Date.now();
      }

      const settleTime = site === 'SharePoint' ? 6000 : 2000;

      if (Date.now() - since >= settleTime) {
        await chrome.storage.local.set({
          monitorProgress:
            `${site} refreshed — starting its reader…`
        });

        return stableDocument;
      }
    }

    await chrome.storage.local.set({
      monitorProgress:
        `${site}: ${reason} ` +
        `(${Math.floor((Date.now() - started) / 1000)}s / 180s)`
    });

    await C.sleep(750);
  }

  throw new Error(
    `${site} load timed out: ${reason}. Reading was skipped.`
  );
}

async function ensureReader(tabId, file, documentId) {
  await chrome.scripting.executeScript({
    target: {
      tabId,
      documentIds: [documentId]
    },
    files: ['common.js', file]
  });
}

async function executeReader(
  tabId,
  file,
  name,
  expected,
  documentId
) {
  if (!documentId) {
    throw new Error(
      'A verified page document is required before reading.'
    );
  }

  await ensureReader(tabId, file, documentId);

  const results = await chrome.scripting.executeScript({
    target: {
      tabId,
      documentIds: [documentId]
    },

    func: async (name, expected) => {
      try {
        return {
          success: true,
          data: await globalThis.CMReaders[name].read(expected)
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    },

    args: [name, expected]
  });

  const response = results[0]?.result;

  if (!response?.success) {
    throw new Error(
      response?.error || 'Case document changed during the read.'
    );
  }

  return response.data;
}

async function sharepoint(settings) {
  const tabs = await chrome.tabs.query({
    url: 'https://factset.sharepoint.com/*'
  });

  const lists = tabs.filter(tab =>
    /\/Lists\//i.test(tab.url || '')
  );

  const candidates = lists.length ? lists : tabs;
  const active = candidates.filter(tab => tab.active);

  const chosen = active.length === 1
    ? active[0]
    : candidates.length === 1
      ? candidates[0]
      : null;

  if (!chosen) {
    throw new Error(
      candidates.length
        ? 'Activate the SharePoint case list you want to scan, or close extra SharePoint list tabs.'
        : 'Open your SharePoint case list and sign in first.'
    );
  }

  await chrome.windows.update(chosen.windowId, {
    focused: true
  });

  await chrome.tabs.update(chosen.id, {
    active: true
  });

  const documentId = await reloadAndWait(
    chosen.id,
    'SharePoint'
  );

  return executeReader(
    chosen.id,
    'sharepoint.js',
    'sharepoint',
    settings,
    documentId
  );
}

function caseNumberFor(item, job) {
  if (item.source !== 'Salesforce') {
    return item.id || '';
  }

  const rows = (job.sharepoint || []).filter(
    row => row.primary?.key === item.key
  );

  return C.caseNumber(item) ||
    rows.map(row =>
      C.caseNumber(row.primary) ||
      C.caseNumber({ label: row.title })
    ).find(Boolean) ||
    '';
}

function caseLabel(item, job) {
  if (item.source !== 'Salesforce') {
    return `${item.source} ${item.id}`;
  }

  const number = caseNumberFor(item, job);

  return number
    ? `Salesforce ${number}`
    : 'Salesforce (number unavailable)';
}

async function cleanupTabs(job) {
  for (const [key, id] of Object.entries(job.scanTabs || {})) {
    try {
      const tab = await chrome.tabs.get(id);

      if (C.target(tab.url)?.key === key) {
        await chrome.tabs.remove(id);
      }
    } catch {}

    delete job.scanTabs[key];
  }
}

async function detail(task, job) {
  const matches = (await chrome.tabs.query({})).filter(
    tab => C.target(tab.pendingUrl || tab.url)?.key === task.key
  );

  matches.sort((a, b) =>
    Number(b.windowId === job.windowId) -
      Number(a.windowId === job.windowId) ||
    Number(b.active) - Number(a.active)
  );

  let tab = matches[0];
  const reusedTab = !!tab;

  if (!tab) {
    tab = await chrome.tabs.create({
      url: task.url,
      windowId: job.windowId,
      active: true
    });

    job.scanTabs ||= {};
    job.scanTabs[task.key] = tab.id;
  }

  let last;

  try {
    await saveJob(job, `Reading ${caseLabel(task, job)}`);

    for (let attempt = 0; attempt < 3; attempt++) {
      await C.cancelled();

      try {
        await chrome.windows.update(tab.windowId, {
          focused: true
        });

        await chrome.tabs.update(tab.id, {
          active: true
        });

        const documentId = await reloadAndWait(
          tab.id,
          task.source,
          reusedTab || attempt > 0
        );

        const actual = await chrome.tabs.get(tab.id);

        if (C.target(actual.url)?.key !== task.key) {
          throw new Error(
            'Case page redirected. Check sign-in or access.'
          );
        }

        const isRpd = task.source === 'RPD';

        const data = await executeReader(
          tab.id,
          isRpd ? 'rpd.js' : 'salesforce.js',
          isRpd ? 'rpd' : 'salesforce',
          task,
          documentId
        );

        if (data.key !== task.key) {
          throw new Error('Reader returned a different case.');
        }

        return {
          ...task,
          ...data,
          caseNumber: data.caseNumber || caseNumberFor(task, job)
        };
      } catch (error) {
        last = error;
        await C.cancelled();

        await chrome.storage.local.set({
          monitorProgress:
            `${caseLabel(task, job)} — attempt ${attempt + 1}/3 failed: ` +
            error.message
        });

        console.warn(
          '[Relay case read failed]',
          task.key,
          attempt + 1,
          error.message
        );

        if (attempt < 2) {
          await C.sleep(1200);
        }
      }
    }

    return {
      ...task,
      caseNumber: caseNumberFor(task, job),
      error: last?.message || 'Could not read case.',
      messages: [],
      latest: null,
      warnings: [last?.message || 'Could not read case.']
    };
  } finally {
    await cleanupTabs(job);
  }
}

function add(job, target, parent, title = '') {
  if (!target) return;

  let item = job.queue.find(entry => entry.key === target.key);

  if (!item) {
    item = {
      ...target,
      title,
      parents: []
    };

    job.queue.push(item);
  }

  if (parent && !item.parents.includes(parent)) {
    item.parents.push(parent);
  }
}

const headings = {
  needsAttention: '🚨 **Likely Needs Attention**',
  stale: '⏰ **Stale / Follow-up (7+ days)**',
  waiting: '⏳ **Waiting on Others**',
  recentlyHandled: '✅ **Recently Handled**',
  resolved: '🏁 **Resolved Cases**'
};

const safe = value =>
  C.text(value).replace(/[\[\]*_`<>|]/g, ' ');

function report(job, items) {
  const groups = {
    needsAttention: [],
    stale: [],
    waiting: [],
    recentlyHandled: [],
    resolved: [],
    unclassified: []
  };

  const lookup = new Map(
    [...job.queue, ...items].map(item => [item.key, item])
  );

  const link = item =>
    `[${safe(caseLabel(item, job))}](${C.target(item.url)?.url || ''})`;

  const date = value => {
    if (!value || !Number.isFinite(Date.parse(value))) {
      return 'Time unavailable';
    }

    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Taipei',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(value));
  };

  const parents = item =>
    [...new Set(item.parents || [])]
      .filter(key => !key.startsWith('SP:'))
      .map(key => lookup.get(key))
      .filter(Boolean);

  const relation = item => {
    if (item.removedFromSharePoint) {
      return 'Previous SharePoint assignment';
    }

    const from = parents(item);

    const assigned = job.sharepoint.some(
      row => row.primary?.key === item.key
    );

    return [
      assigned ? 'Your SharePoint assignment' : 'Related case',
      from.length
        ? 'Related to: ' + from.map(link).join(', ')
        : ''
    ].filter(Boolean).join(' — ');
  };

  const reason = item => {
    const attention = item.attention;

    if (attention.finished) {
      return safe(attention.reason);
    }

    if (attention.group === 'unclassified') {
      return 'Check manually: ' + safe(attention.reason);
    }

    if (attention.senderType === 'CLIENT') {
      return 'Client replied — immediate attention';
    }

    if (attention.group === 'needsAttention') {
      return 'Outside your team replied — review needed';
    }

    if (attention.group === 'stale') {
      return `No new reply for ${Math.floor(attention.ageDays)} days — follow up`;
    }

    return attention.senderType === 'ME'
      ? 'You replied last'
      : 'Your teammate replied last';
  };

  for (const item of items) {
    const group = item.attention.finished
      ? 'resolved'
      : item.attention.group;

    groups[group].push(item);
  }

  for (const row of job.removedAssignments || []) {
    if (
      !row.primary ||
      groups.resolved.some(item => item.key === row.primary.key)
    ) {
      continue;
    }

    groups.resolved.push({
      ...row.primary,
      title: row.title,
      parents: [],
      removedFromSharePoint: true,
      detectedAt: job.sharepointScannedAt,
      latest: null,
      attention: {
        group: 'resolved',
        finished: true,
        reason:
          'Removed from SharePoint since the previous completed scan — treated as resolved.'
      }
    });
  }

  groups.needsAttention.sort((a, b) =>
    (a.attention.senderType === 'CLIENT' ? 0 : 1) -
    (b.attention.senderType === 'CLIENT' ? 0 : 1)
  );

  const checked = date(new Date().toISOString());

  const finished = items.filter(
    item => item.attention.finished
  ).length;

  const intro =
    `${job.sharepoint.length} SharePoint assignments · ` +
    `${items.length} case pages checked · ${finished} finished · ` +
    `${groups.unclassified.length} need manual checking`;

  const lines = [
    '📋 Relay Case Review',
    `Checked: ${checked} (UTC+8)`,
    intro
  ];

  const sections = job.full
    ? Object.keys(headings)
    : ['needsAttention', 'stale'];

  if (groups.unclassified.length) {
    sections.unshift('unclassified');
  }

  const text = (value, bold = false) => ({
    type: 'TextBlock',
    text: value || '—',
    wrap: true,
    ...(bold ? { weight: 'Bolder' } : {})
  });

  const columns = values => ({
    type: 'ColumnSet',
    separator: true,
    columns: values.map((value, index) => ({
      type: 'Column',
      width: index === 0 ? 2 : 3,
      items: [text(value)]
    }))
  });

  const cards = [];

  const card = (title, body) => ({
    $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.2',
    msteams: { width: 'Full' },
    body: [
      text('📋 Relay Case Review', true),
      text(`Checked: ${checked} (UTC+8)`),
      text(intro),
      text(title, true),
      ...body
    ]
  });

  for (const group of sections) {
    const title = group === 'unclassified'
      ? '⚠ Needs manual checking'
      : headings[group].replaceAll('**', '');

    lines.push('', `${title} (${groups[group].length})`, '');

    if (!groups[group].length) {
      lines.push('None.');
      cards.push(card(title, [text('None.')]));
      continue;
    }

    const rows = [];

    for (const item of groups[group]) {
      const author = safe(
        item.removedFromSharePoint
          ? 'Not available — no case page read'
          : item.latest?.author || 'Author unavailable'
      );

      const when = date(item.latest?.date);

      lines.push(
        link(item),
        `Latest reply: ${author} · ${when}`,
        `Action: ${reason(item)}`,
        relation(item)
      );

      if (item.warnings?.length) {
        lines.push(
          'Read warning: ' + safe(item.warnings.join(' '))
        );
      }

      lines.push('');

      rows.push(columns([
        link(item),
        `${author}\n\n${when}\n\n${reason(item)}`,
        relation(item)
      ]));
    }

    let part = [];

    const header = columns([
      '**Case**',
      '**Latest reply / action**',
      '**Assignment / related main case**'
    ]);

    for (const row of rows) {
      const bytes = new TextEncoder().encode(
        JSON.stringify(card(title, [header, ...part, row]))
      ).length;

      if (
        part.length &&
        (part.length >= 10 || bytes > 23000)
      ) {
        cards.push(card(title, [header, ...part]));
        part = [];
      }

      part.push(row);
    }

    if (part.length) {
      cards.push(card(title, [header, ...part]));
    }
  }

  const warnings = [...new Set(job.warnings || [])];

  if (warnings.length) {
    lines.push(
      '',
      '⚠ Read warnings',
      '',
      ...warnings.map(warning => '- ' + safe(warning))
    );

    for (let index = 0; index < warnings.length; index += 10) {
      cards.push(card(
        '⚠ Read warnings',
        warnings
          .slice(index, index + 10)
          .map(warning => text(safe(warning)))
      ));
    }
  }

  const escape = value =>
    String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));

  const htmlLink = item => {
    const target = C.target(item.url);

    return target
      ? `<a href="${escape(target.url)}">${escape(caseLabel(item, job))}</a>`
      : escape(caseLabel(item, job));
  };

  const table = (headers, rows) =>
    '<table style="border-collapse:collapse;width:100%">' +
    '<thead><tr>' +
    headers.map(header =>
      `<th style="border:1px solid #888;padding:4px">${escape(header)}</th>`
    ).join('') +
    '</tr></thead><tbody>' +
    rows.map(row =>
      '<tr>' +
      row.map(cell =>
        `<td style="border:1px solid #888;padding:4px">${cell}</td>`
      ).join('') +
      '</tr>'
    ).join('') +
    '</tbody></table><br><br>\n\n';

  const summaryRows = [
    ['Assigned to', escape(job.settings?.rpdName || '')],
    ['Checked', escape(checked) + ' (UTC+8)'],
    ['SharePoint assignments', String(job.sharepoint.length)],
    ['Case pages checked', String(items.length)],
    ['Current RPDs resolved', String(finished)],
    [
      'Removed from SharePoint since previous scan',
      String((job.removedAssignments || []).length)
    ],
    [
      'SharePoint comparison',
      escape(job.sharepointComparison || 'Baseline not available')
    ],
    ['Needs manual checking', String(groups.unclassified.length)]
  ];

  const htmlHeader =
    '<p><strong>📋 Relay Case Review</strong></p>' +
    table(['Field', 'Value'], summaryRows);

  const htmlParts = [];

  for (const group of sections) {
    const title = group === 'unclassified'
      ? '⚠ Needs manual checking'
      : headings[group].replaceAll('**', '');

    const sectionTitle =
      `<p><strong>${escape(title)} (${groups[group].length})</strong></p>`;

    if (!groups[group].length) {
      htmlParts.push(sectionTitle + '<p>None.</p>');
      continue;
    }

    const rows = groups[group].map(item => {
      const from = parents(item);

      const assigned = job.sharepoint.some(
        row => row.primary?.key === item.key
      );

      const relationship = [
        item.removedFromSharePoint
          ? 'Previous SharePoint assignment'
          : assigned
            ? 'Your SharePoint assignment'
            : 'Related case',
        from.length
          ? 'Related to: ' + from.map(htmlLink).join('<br>')
          : ''
      ].filter(Boolean).join('<br>');

      const verified = group !== 'unclassified';

      const author = item.removedFromSharePoint
        ? 'Not available — no case page read'
        : item.latest?.author || 'Unavailable';

      return [
        htmlLink(item),
        escape(author) +
          (verified ? '' : '<br><em>Latest not verified</em>'),
        escape(date(item.latest?.date)),
        escape(reason(item)),
        relationship
      ];
    });

    let part = [];

    const render = rows =>
      sectionTitle +
      table(
        [
          'Case',
          'Last author',
          'Last reply (UTC+8)',
          'Action / status',
          'Main case / assignment'
        ],
        rows
      );

    for (const row of rows) {
      const bytes = new TextEncoder().encode(
        htmlHeader + render([...part, row])
      ).length;

      if (part.length && bytes > 20000) {
        htmlParts.push(render(part));
        part = [];
      }

      part.push(row);
    }

    if (part.length) {
      htmlParts.push(render(part));
    }
  }

  if (warnings.length) {
    const warningTitle =
      '<p><strong>⚠ Read warnings</strong></p>';

    let warningRows = [];

    const renderWarnings = rows =>
      warningTitle +
      table(['Case / source', 'Read warning'], rows);

    for (const warning of warnings) {
      const match = [...lookup.values()].find(item =>
        warning.startsWith(caseLabel(item, job) + ': ')
      );

      const row = match
        ? [
            htmlLink(match),
            escape(
              warning.slice(caseLabel(match, job).length + 2)
            )
          ]
        : ['SharePoint / monitor', escape(warning)];

      const bytes = new TextEncoder().encode(
        htmlHeader + renderWarnings([...warningRows, row])
      ).length;

      if (warningRows.length && bytes > 20000) {
        htmlParts.push(renderWarnings(warningRows));
        warningRows = [];
      }

      warningRows.push(row);
    }

    if (warningRows.length) {
      htmlParts.push(renderWarnings(warningRows));
    }
  }

  const htmlReports = [];
  let current = htmlHeader;

  for (const part of htmlParts) {
    const bytes = new TextEncoder().encode(
      current + part
    ).length;

    if (current !== htmlHeader && bytes > 22000) {
      htmlReports.push(current);
      current = htmlHeader;
    }

    current += part;
  }

  htmlReports.push(current);

  return {
    groups,
    message: lines.join('\n'),
    adaptiveCards: cards,
    messageHtml: htmlHeader + htmlParts.join(''),
    htmlReports
  };
}

async function send(
  message,
  settings,
  title = 'Relay Case Review',
  adaptiveCards = [],
  htmlReports = []
) {
  if (!settings.powerAutomateUrl) {
    throw new Error(
      'Power Automate HTTP URL is not configured.'
    );
  }

  const url = new URL(settings.powerAutomateUrl);

  if (
    url.protocol !== 'https:' ||
    !/(?:^|\.)(?:logic\.azure\.com|environment\.api\.powerplatform\.com)$/
      .test(url.hostname)
  ) {
    throw new Error(
      'Use a Power Automate URL covered by the extension host permissions.'
    );
  }

  deliveryController = new AbortController();

  const timeout = setTimeout(
    () => deliveryController?.abort(),
    25000
  );

  try {
    const response = await fetch(url.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'Monitor Summary',
        caseId: '',
        title,
        reason: 'Case review',
        parentCase: '',
        updatedBy: '',
        updatedDate: new Date().toLocaleString(),
        comment: message,
        caseUrl: '',
        message,

        htmlReports: htmlReports.length
          ? htmlReports
          : ['<p>Relay test notification.</p>'],

        messageHtml: htmlReports.length
          ? htmlReports.join('<br>')
          : '<p>Relay test notification.</p>',

        adaptiveCards: adaptiveCards.length
          ? adaptiveCards
          : [{
              type: 'AdaptiveCard',
              version: '1.2',
              body: [{
                type: 'TextBlock',
                text: message,
                wrap: true
              }]
            }]
      }),
      signal: deliveryController.signal
    });

    if (!response.ok) {
      throw new Error(
        `Power Automate returned HTTP ${response.status}.`
      );
    }
  } finally {
    clearTimeout(timeout);
    deliveryController = null;
  }
}

async function finish(job) {
  const records = await chrome.storage.local.get(
    job.queue.map(task => `cmCase:${task.key}`)
  );

  const items = job.queue.map(task => {
    const item = records[`cmCase:${task.key}`];

    const current = item?.runId === job.id
      ? { ...item, parents: task.parents }
      : {
          ...task,
          error: 'Case was not read during this run.'
        };

    return {
      ...current,
      attention: C.classify(current, job.settings)
    };
  });

  await C.cancelled();

  const {
    groups,
    message,
    adaptiveCards,
    messageHtml,
    htmlReports
  } = report(job, items);

  const hasAlerts =
    groups.needsAttention.length + groups.stale.length > 0;

  const result = {
    success: true,
    partial:
      groups.unclassified.length > 0 ||
      job.warnings.length > 0,
    unclassifiedCount: groups.unclassified.length,
    removedFromSharePointCount:
      (job.removedAssignments || []).length,
    resolvedCount: groups.resolved.length,
    finishedCount: items.filter(
      item => item.attention.finished
    ).length,
    tabGroups: 0,
    sharePointCases: job.sharepoint.length,
    rpdWatched: items.filter(
      item => item.source === 'RPD'
    ).length,
    salesforceWatched: items.filter(
      item => item.source === 'Salesforce'
    ).length,
    spinOffRpds: job.queue.filter(task =>
      task.parents.some(parent => !parent.startsWith('SP:')) ||
      !job.sharepoint.some(
        row => row.primary?.key === task.key
      )
    ).length,
    summarySent: false,
    review: groups,
    warnings: job.warnings || [],
    message,
    adaptiveCards,
    messageHtml,
    htmlReports
  };

  if (
    job.full ||
    (hasAlerts && job.settings.powerAutomateUrl)
  ) {
    if (job.delivery === 'failed') {
      result.summaryError =
        job.deliveryError || 'Report delivery failed.';
    } else if (job.delivery === 'sending') {
      result.summaryError =
        'Previous send was interrupted; delivery is unknown. Not automatically resent.';
    } else if (job.delivery === 'sent') {
      result.summarySent = true;
    } else {
      job.delivery = 'sending';
      await saveJob(job, 'Sending report…');

      try {
        await send(
          message,
          job.settings,
          'Relay Case Review',
          adaptiveCards,
          htmlReports
        );

        job.delivery = 'sent';
        result.summarySent = true;
      } catch (error) {
        job.delivery = 'failed';
        job.deliveryError = error.message;
        result.summaryError = error.message;
      }

      await saveJob(job, 'Finishing…');
    }
  }

  await C.cancelled();

  job.status = 'done';
  await saveJob(job, 'Complete');

  await chrome.storage.local.set({
    monitorStopRequested: false
  });

  await chrome.storage.local.set({
    lastMonitorRun: new Date().toISOString(),
    lastMonitorResult: result,
    latestCaseReview: groups,
    currentWatchList: job.sharepoint,
    currentRpdWatchList: job.queue.filter(
      task => task.source === 'RPD'
    ),
    currentSalesforceWatchList: job.queue.filter(
      task => task.source === 'Salesforce'
    ),
    currentSharePointSpinOffs: job.queue.filter(task =>
      !job.sharepoint.some(
        row => row.primary?.key === task.key
      )
    )
  });

  if (
    job.saveAssignmentBaseline &&
    job.sharepointScope
  ) {
    await chrome.storage.local.set({
      relayAssignmentBaseline: {
        scope: job.sharepointScope,
        identity: C.norm(job.settings.rpdName),
        checkedAt: job.sharepointScannedAt,
        cases: job.sharepoint.map(row => ({
          primary: row.primary,
          title: row.title
        }))
      }
    });
  }

  await chrome.alarms.clear('cmResume');
}

async function pump() {
  if (busy) return;
  busy = true;

  const heartbeat = setInterval(
    () => chrome.storage.local
      .get('monitorStopRequested')
      .catch(() => {}),
    20000
  );

  let job;

  try {
    job = await readJob();

    if (!job || job.status !== 'running') return;

    await C.cancelled();

    if (job.version !== '3.1.0') {
      throw new Error(
        'Previous-version run stopped. Start a new run with version 3.1.0.'
      );
    }

    await cleanupTabs(job);

    if (job.stage === 'sharepoint') {
      const data = await sharepoint(job.settings);

      job.sharepoint = data.cases;
      job.warnings = data.warnings || [];

      const scope = new URL(data.scope);
      scope.hash = '';

      job.sharepointScope = scope.href;
      job.sharepointScannedAt = new Date().toISOString();
      job.removedAssignments = [];

      const { relayAssignmentBaseline } =
        await chrome.storage.local.get('relayAssignmentBaseline');

      const comparable =
        relayAssignmentBaseline &&
        relayAssignmentBaseline.scope === job.sharepointScope &&
        relayAssignmentBaseline.identity === C.norm(job.settings.rpdName);

      const completeKeys = data.cases.every(
        row => row.primary?.key
      );

      job.saveAssignmentBaseline = completeKeys;

      if (comparable && completeKeys) {
        const present = new Set(
          data.cases.map(row => row.primary.key)
        );

        job.removedAssignments =
          relayAssignmentBaseline.cases.filter(row =>
            row.primary?.key &&
            !present.has(row.primary.key)
          );

        job.sharepointComparison =
          'Compared with completed scan at ' +
          relayAssignmentBaseline.checkedAt;
      } else {
        job.sharepointComparison = completeKeys
          ? 'First completed scan for this account/view establishes the baseline.'
          : 'Comparison skipped because some assignment links could not be read.';
      }

      job.rootKeys = [...new Set(
        data.cases
          .map(item => item.primary?.key)
          .filter(Boolean)
      )];

      for (const item of data.cases) {
        add(
          job,
          item.primary,
          `SP:${item.title}`,
          item.title
        );

        for (const linkedCase of item.links || []) {
          add(
            job,
            linkedCase,
            item.primary?.key || `SP:${item.title}`
          );
        }
      }

      if (!data.cases.length && !comparable) {
        throw new Error(
          'No SharePoint rows match your full name in AM Assignee. No case pages were opened.'
        );
      }

      if (!job.queue.length && data.cases.length) {
        throw new Error(
          'Your assigned rows contain no supported case links.'
        );
      }

      job.stage = 'cases';

      await saveJob(
        job,
        `Reading ${job.queue.length} cases…`
      );
    }

    while (job.index < job.queue.length) {
      await C.cancelled();

      const task = job.queue[job.index];

      await saveJob(
        job,
        `Reading ${job.index + 1}/${job.queue.length}: ${caseLabel(task, job)}`
      );

      let item;

      try {
        item = await detail(task, job);
      } catch (error) {
        item = {
          ...task,
          error: error.message,
          messages: [],
          latest: null,
          warnings: [error.message]
        };
      }

      await C.cancelled();

      item.runId = job.id;
      item.parents = task.parents;

      await chrome.storage.local.set({
        [`cmCase:${task.key}`]: item
      });

      for (const warning of item.warnings || []) {
        job.warnings.push(
          `${caseLabel(item, job)}: ${warning}`
        );
      }

      if (job.rootKeys.includes(task.key)) {
        const direct = (item.links || []).filter(
          linkedCase => linkedCase.key !== task.key
        );

        if (direct.length > 50) {
          job.warnings.push(
            `${caseLabel(task, job)}: more than 50 related cases; only the first 50 were queued.`
          );
        }

        for (const linkedCase of direct.slice(0, 50)) {
          add(job, linkedCase, task.key);
        }
      }

      job.index++;

      await saveJob(
        job,
        `Read ${job.index}/${job.queue.length} cases`
      );
    }

    await C.cancelled();
    await finish(job);
  } catch (error) {
    if (job) {
      const stopped = (
        await chrome.storage.local.get('monitorStopRequested')
      ).monitorStopRequested;

      job.status = stopped ? 'stopped' : 'failed';

      await saveJob(job, error.message);

      await chrome.storage.local.set({
        lastMonitorResult: {
          success: false,
          stopped,
          error: error.message
        }
      });

      await chrome.alarms.clear('cmResume');
    }
  } finally {
    if (job?.version === '3.1.0') {
      await cleanupTabs(job);
    }

    clearInterval(heartbeat);
    busy = false;
  }
}

async function start(full) {
  if (starting) {
    throw new Error('A run is already starting.');
  }

  starting = true;

  try {
    if (
      busy ||
      (await readJob())?.status === 'running'
    ) {
      throw new Error('A run is already active.');
    }

    const settings = await loadSettings();

    if (!settings.rpdName.trim()) {
      throw new Error(
        'Save your full name and team in Settings first.'
      );
    }

    if (full && !settings.powerAutomateUrl) {
      throw new Error(
        'Save your Power Automate HTTP URL in Settings before Run + Send Report.'
      );
    }

    const window = await chrome.windows.getLastFocused();

    const job = {
      version: '3.1.0',
      windowId: window.id,
      scanTabs: {},
      id: crypto.randomUUID(),
      status: 'running',
      stage: 'sharepoint',
      index: 0,
      queue: [],
      sharepoint: [],
      warnings: [],
      full,
      settings
    };

    await chrome.storage.local.set({
      monitorStopRequested: false
    });

    await saveJob(
      job,
      'Reading assigned SharePoint cases…'
    );

    await chrome.alarms.create('cmResume', {
      periodInMinutes: 0.5
    });

    setTimeout(pump, 0);

    return {
      success: true,
      started: true
    };
  } finally {
    starting = false;
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'cmResume') {
    void pump();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.clear('monitorCases');
  void pump();
});

chrome.runtime.onStartup.addListener(() => {
  void pump();
});

chrome.runtime.onMessage.addListener(
  (message, sender, reply) => {
    if (!own(sender)) return;

    const actions = {
      GET_DEFAULT_SETTINGS: async () => {
        await loadSettings();

        return {
          success: true,
          defaults
        };
      },

      RUN_MONITOR_NOW: () =>
        start(message.sendSummary === true),

      STOP_MONITOR: async () => {
        deliveryController?.abort();

        await chrome.storage.local.set({
          monitorStopRequested: true
        });

        void pump();

        return {
          success: true
        };
      },

      TEST_TEAMS_NOTIFICATION: async () => {
        if (
          busy ||
          starting ||
          (await readJob())?.status === 'running'
        ) {
          throw new Error(
            'Wait for the current run to finish before testing.'
          );
        }

        await send(
          'Relay test notification.',
          await loadSettings(),
          'Test'
        );

        return {
          success: true
        };
      }
    };

    if (!actions[message.action]) return;

    actions[message.action]()
      .then(reply)
      .catch(error => reply({
        success: false,
        error: error.message
      }));

    return true;
  }
);