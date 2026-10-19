/* Shared rules and DOM helpers. No page text is executed. */
(() => {
  if (globalThis.CM?.version === '3.1.1') return;

  const text = x =>
    String(x?.textContent ?? x ?? '').replace(/\s+/g, ' ').trim();

  const norm = x =>
    text(x).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const all = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  const visible = element =>
    !!element?.getClientRects().length &&
    getComputedStyle(element).visibility !== 'hidden';

  function target(value, base = 'https://rpd.factset.com/') {
    try {
      const url = new URL(value, base);
      if (url.protocol !== 'https:') return null;

      if (
        url.hostname === 'rpd.factset.com' &&
        /\/summary\.aspx$/i.test(url.pathname)
      ) {
        const id = [...url.searchParams].find(
          ([key]) => key.toLowerCase() === 'messageid'
        )?.[1];

        if (/^\d+$/.test(id || '')) {
          return {
            key: `RPD:${id}`,
            source: 'RPD',
            id,
            url: `https://rpd.factset.com/summary.aspx?messageid=${id}`
          };
        }
      }

      if (url.hostname === 'factset.lightning.force.com') {
        const id = url.pathname.match(
          /\/Case\/(500[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)(?:\/|$)/
        )?.[1];

        if (id) {
          return {
            key: `Salesforce:${id.slice(0, 15)}`,
            source: 'Salesforce',
            id,
            url: `https://factset.lightning.force.com/lightning/r/Case/${id}/view`
          };
        }
      }
    } catch {}

    return null;
  }

  function links(root, base = globalThis.location?.href) {
    if (!root) return [];

    const found = new Map();

    for (const anchor of all('a[href]', root)) {
      const item = target(anchor.getAttribute('href'), base);

      if (item) {
        found.set(item.key, { ...item, label: text(anchor) });
      }
    }

    return [...found.values()];
  }

  function explicitLinks(root, base = globalThis.location?.href) {
    const found = new Map();
    if (!root) return [];

    const blocks = all('p,li,div', root).filter(
      element => !element.querySelector('p,li,div')
    );

    for (const block of blocks) {
      const raw = text(block);

      if (
        !/\b(?:spin[\s-]*off|spinning off|duplicate of|linked (?:case|rpd))\b/i
          .test(raw) ||
        raw.length > 900
      ) {
        continue;
      }

      for (const item of links(block, base)) {
        found.set(item.key, item);
      }

      for (const match of raw.matchAll(/https:\/\/[^\s<>"']+/gi)) {
        const item = target(match[0].replace(/[.,;)]+$/, ''), base);
        if (item) found.set(item.key, item);
      }

      for (const match of raw.matchAll(/\bRPD\s*[:#]\s*(\d{7,12})\b/gi)) {
        const item = target(
          `https://rpd.factset.com/summary.aspx?messageid=${match[1]}`
        );

        found.set(item.key, item);
      }
    }

    return [...found.values()];
  }

  function scroller(element) {
    for (let parent = element; parent; parent = parent.parentElement) {
      if (
        parent.scrollHeight > parent.clientHeight + 5 &&
        (
          parent.dataset?.isScrollable === 'true' ||
          /(auto|scroll)/.test(getComputedStyle(parent).overflowY)
        )
      ) {
        return parent;
      }
    }

    return document.scrollingElement || document.documentElement;
  }

  async function cancelled() {
    const settings = await chrome.storage.local.get(
      'monitorStopRequested'
    );

    if (settings.monitorStopRequested) {
      throw new Error('Run stopped.');
    }
  }

  async function waitFor(fn, timeout = 20000) {
    const end = Date.now() + timeout;

    while (Date.now() < end) {
      await cancelled();

      const value = fn();
      if (value) return value;

      await sleep(250);
    }

    throw new Error(
      'Page elements did not load. Check sign-in and case access.'
    );
  }

  async function expand(root, pattern, limit = 60) {
    const clicked = new WeakSet();

    for (let index = 0; index < limit; index++) {
      await cancelled();

      const button = all('a,button,[role="button"]', root).find(
        element =>
          visible(element) &&
          !element.disabled &&
          !clicked.has(element) &&
          pattern.test(
            text(element) ||
            element.title ||
            element.getAttribute('aria-label') ||
            ''
          )
      );

      if (!button) return;

      clicked.add(button);
      button.click();
      await sleep(250);
    }
  }

  function stamp(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }

  function latest(messages) {
    if (!messages.length) return null;

    const dated = messages.map(message => ({
      message,
      time: stamp(message.date)
    }));

    if (dated.some(entry => entry.time === null)) return null;

    const newest = Math.max(...dated.map(entry => entry.time));

    const candidates = dated
      .filter(entry => entry.time === newest)
      .map(entry => entry.message);

    if (candidates.some(message => !text(message.author))) {
      return null;
    }

    const identities = new Set(
      candidates.map(message => [
        message.author,
        message.authorId || '',
        message.authorType || ''
      ].join('|'))
    );

    return identities.size === 1 ? candidates[0] : null;
  }

  function caseNumber(item) {
    for (const value of [item.caseNumber, item.label]) {
      const raw = text(value);

      const match =
        raw.match(/^(\d{5,12})$/) ||
        raw.match(/^(\d{5,12})\s*\|\s*Case\b/i) ||
        raw.match(/^(?:Salesforce|SF|Case)\s*(?:Case\s*)?[#:]?\s*(\d{5,12})\b/i);

      if (match) return match[1];
    }

    return '';
  }

  function identity(message, settings) {
    const author = norm(message?.author);

    if (message?.authorType === 'client') return 'CLIENT';

    if (
      !author ||
      /^(unknown|system|case systems process)$/.test(author)
    ) {
      return 'UNKNOWN';
    }

    const values = [
      author,
      norm(message.authorEmail),
      norm(message.authorId)
    ].filter(Boolean);

    const matches = person =>
      [
        person.name,
        person.ownerAlias,
        person.email,
        person.employeeId
      ]
        .filter(Boolean)
        .some(value => values.includes(norm(value)));

    if (matches({
      name: settings.rpdName,
      ownerAlias: settings.salesforceAlias
    })) {
      return 'ME';
    }

    if ((settings.myTeam || []).some(matches)) {
      return 'TEAM';
    }

    return 'OTHER';
  }

  function classify(item, settings, now = Date.now()) {
    const senderType = identity(item.latest, settings);
    const date = stamp(item.latest?.date);

    const ageDays = date === null
      ? null
      : Math.max(0, (now - date) / 86400000);

    // Use CURRENT RPD status, not historical resolved comments.
    if (
      item.source === 'RPD' &&
      norm(item.status) === 'resolved'
    ) {
      return {
        group: 'recentlyHandled',
        senderType,
        ageDays,
        finished: true,
        reason: 'Finished / Resolved — no case action needed.'
      };
    }

    if (
      item.error ||
      !item.latest ||
      senderType === 'UNKNOWN' ||
      date === null
    ) {
      return {
        group: 'unclassified',
        senderType,
        ageDays,
        reason:
          item.error ||
          'Latest message author or time could not be verified.'
      };
    }

    if (senderType === 'CLIENT') {
      return {
        group: 'needsAttention',
        senderType,
        ageDays,
        reason: 'IMMEDIATE: the client wrote the latest message.'
      };
    }

    if (senderType === 'OTHER') {
      return {
        group: 'needsAttention',
        senderType,
        ageDays,
        reason: 'The latest author is outside your configured team.'
      };
    }

    if (ageDays >= 7) {
      return {
        group: 'stale',
        senderType,
        ageDays,
        reason: 'Team last replied at least 7 days ago; follow-up is due.'
      };
    }

    if (senderType === 'ME') {
      return {
        group: 'recentlyHandled',
        senderType,
        ageDays,
        reason: 'You wrote the latest message.'
      };
    }

    return {
      group: 'waiting',
      senderType,
      ageDays,
      reason: 'Your teammate wrote the latest message; no new outside reply.'
    };
  }

  globalThis.CM = {
    version: '3.1.1',
    text,
    norm,
    sleep,
    all,
    visible,
    target,
    links,
    explicitLinks,
    scroller,
    cancelled,
    waitFor,
    expand,
    stamp,
    latest,
    caseNumber,
    identity,
    classify
  };
})();