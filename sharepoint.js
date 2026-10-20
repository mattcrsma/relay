(() => {
  if (globalThis.CMReaders?.sharepoint?.version === '3.1.0') return;

  const C = CM;

  const rows = () => [
    ...document.querySelectorAll(
      '#list-content-id [role="row"][data-automationid^="row-"]'
    )
  ].filter(row =>
    /^row-\d+$/.test(
      row.getAttribute('data-automationid') || ''
    )
  );

  function field(row, name) {
    return row.querySelector(`[data-automationid="field-${name}"]`);
  }

  function assigned(row, settings) {
    const cell = field(row, 'AMAssignee');
    if (!cell) return false;

    const people = [
      ...cell.querySelectorAll('[aria-label^="Opens profile card for "]')
    ].map(element =>
      element.getAttribute('aria-label')
        .slice('Opens profile card for '.length)
    );

    if (!people.length) {
      people.push(
        ...[...cell.querySelectorAll('[class*="personDisplayName"]')]
          .map(C.text)
      );
    }

    return people.some(
      name => C.norm(name) === C.norm(settings.rpdName)
    );
  }

  async function comments(row) {
    const button = row.querySelector(
      '[data-automationid="addCommentHeroField"]'
    );

    if (!button) {
      return {
        comments: [],
        links: [],
        warning: 'SharePoint comment control was not found.'
      };
    }

    if (document.querySelector('.sp-itemDialog')) {
      throw new Error(
        'Close the open SharePoint item dialog before running.'
      );
    }

    button.click();
    let dialog;

    try {
      dialog = await C.waitFor(
        () => document.querySelector('.sp-itemDialog')
      );

      const pane = await C.waitFor(
        () => dialog.querySelector('.commentsPane')
      );

      await C.sleep(1000);

      const collected = new Map();
      const related = new Map();
      const scroll = C.scroller(pane);

      let stable = 0;
      let previous = '';

      for (let index = 0; index < 100; index++) {
        await C.cancelled();

        await C.expand(
          pane,
          /^(?:show|load|view) (?:more|older) comments(?:.*)$/i,
          5
        );

        for (const node of pane.querySelectorAll(
          '.od-ItemActivity-item-focusZone[role="row"]'
        )) {
          const body = node.querySelector(
            '.od-itemActivity-commentActivity-commentContent'
          );

          const content = C.text(body || node);
          const raw = C.text(node);

          if (content) {
            collected.set(raw, { text: content, rawText: raw });
          }
        }

        for (const item of C.explicitLinks(pane)) {
          related.set(item.key, item);
        }

        const signature =
          `${collected.size}/${scroll.scrollHeight}/${scroll.scrollTop}`;

        const bottom =
          scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 5;

        stable = bottom && signature === previous ? stable + 1 : 0;

        if (stable >= 4) {
          return {
            comments: [...collected.values()],
            links: [...related.values()]
          };
        }

        previous = signature;
        scroll.scrollTop += Math.max(100, scroll.clientHeight * .8);
        scroll.dispatchEvent(new Event('scroll', { bubbles: true }));

        await C.sleep(600);
      }

      return {
        comments: [...collected.values()],
        links: [...related.values()],
        warning:
          'SharePoint comments reached the scan limit; history may be incomplete.'
      };
    } finally {
      const close = dialog?.querySelector(
        '.sp-itemDialog-closeBtn,button[title="Close"],button[aria-label="Close"]'
      );

      close?.click();
      if (close) await C.sleep(300);
    }
  }

  async function read(settings) {
    await C.waitFor(() => document.querySelector('#list-content-id'));

    const first = rows()[0];

    if (!first) {
      throw new Error(
        'No SharePoint rows found. Open the populated case list first.'
      );
    }

    const scroll = C.scroller(first);
    const original = scroll.scrollTop;
    const found = new Map();
    const warnings = [];

    let stable = 0;
    let previous = '';

    scroll.scrollTop = 0;
    await C.sleep(800);

    try {
      for (let step = 0; step < 300; step++) {
        await C.cancelled();

        for (const row of rows()) {
          if (!/^row-\d+$/.test(
            row.getAttribute('data-automationid') || ''
          )) {
            continue;
          }

          if (!field(row, 'AMAssignee')) {
            throw new Error(
              'AM Assignee column is missing. Show it in SharePoint before running.'
            );
          }

          if (!assigned(row, settings)) continue;

          const title = C.text(field(row, 'LinkTitle'));
          const primary = C.links(field(row, 'Link'))[0];

          if (primary?.source === 'Salesforce') {
            primary.caseNumber =
              C.caseNumber(primary) ||
              C.caseNumber({ label: title });
          }

          const rowId = row.getAttribute('data-automationid');

          const key = primary?.key ||
            `${location.href}#${rowId}:${title}`;

          if (found.has(key)) continue;

          const item = {
            key,
            rowId,
            title,
            status: C.text(field(row, 'Status')),
            primary,
            comments: [],
            links: []
          };

          found.set(key, item);

          try {
            Object.assign(item, await comments(row));
          } catch (error) {
            item.warning = error.message;
          }

          if (item.warning) {
            warnings.push(`${title}: ${item.warning}`);
          }

          if (!primary) {
            warnings.push(
              `${title}: no supported RPD/Salesforce link found.`
            );
          }
        }

        const signature =
          `${found.size}/${scroll.scrollHeight}/${scroll.scrollTop}`;

        const bottom =
          scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 5;

        stable = bottom && signature === previous ? stable + 1 : 0;

        if (stable >= 4) {
          return {
            cases: [...found.values()],
            warnings,
            scope: location.href
          };
        }

        previous = signature;
        scroll.scrollTop += Math.max(100, scroll.clientHeight * .8);
        scroll.dispatchEvent(new Event('scroll', { bubbles: true }));

        await C.sleep(650);
      }

      throw new Error(
        'SharePoint scan limit reached before the end. Narrow the list view and retry.'
      );
    } finally {
      scroll.scrollTop = original;
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  }

  globalThis.CMReaders ||= {};

  globalThis.CMReaders.sharepoint = {
    version: '3.1.0',
    read,
    assigned
  };
})();