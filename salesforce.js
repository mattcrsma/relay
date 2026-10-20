(() => {
  if (globalThis.CMReaders?.salesforce?.version === '3.1.7') {
    return;
  }

  const C = CM;

  const accepted = new Set([
    'EmailMessageEvent',
    'TextPost',
    'ContentPost',
    'LinkPost',
    'QuestionPost',
    'CaseCommentPost'
  ]);

  function parseArticle(article) {
    if (!accepted.has(article.dataset.type)) {
      return null;
    }

    // Prevent nested replies from supplying their parent's timestamp.
    article = article.cloneNode(true);

    article.querySelectorAll(
      '.forceChatterComment,.forceChatterFeedComment'
    ).forEach(node => node.remove());

    const header = article.querySelector('.cuf-feedItemHeader');
    const actor = header?.querySelector('.preamble_left');
    const copy = actor?.cloneNode(true);

    copy?.querySelectorAll('.cuf-additionalActorLink')
      .forEach(element => element.remove());

    const author = C.text(copy);

    const isTeamMailbox =
      C.norm(author) === C.norm('FactSet DS-Core Support');

    const authorType = isTeamMailbox
      ? 'teamMailbox'
      : header?.querySelector('img[src*="eventcustomer"]')
        ? 'client'
        : 'employee';

    const authorId =
      actor?.querySelector('[data-id]')?.dataset.id || '';

    const iso = [
      ...article.querySelectorAll(
        '.slds-assistive-text,.assistiveText'
      )
    ]
      .map(C.text)
      .map(value =>
        value.match(
          /^Comment on .*? at (\d{4}-\d\d-\d\dT[^\s]+Z)$/
        )?.[1]
      )
      .find(Boolean);

    const time = article.querySelector('time[datetime]');
    const date = iso || time?.getAttribute('datetime') || '';

    const preview = article.querySelector(
      'iframe[title="Email Preview"]'
    );

    const emailHtml = preview?.getAttribute('srcdoc');
    let body = null;

    if (emailHtml) {
      body = new DOMParser()
        .parseFromString(emailHtml, 'text/html')
        .body;

      body.querySelectorAll(
        'script,style,[style*="display:none"],[style*="display: none"]'
      ).forEach(element => element.remove());
    }

    const expanded = article.querySelector(
      '.cuf-body,.feedBodyInner,.feedBody,.forceChatterFeedBodyText'
    );

    const summary = article.querySelector(
      '.preamble_custom-summary'
    );

    if (!body) {
      body = expanded || summary;
    }

    const isEmail = article.dataset.type === 'EmailMessageEvent';

    return {
      id: article.dataset.id,
      kind: article.dataset.type,
      author,
      authorId,
      authorType,
      date,
      displayDate: C.text(
        header?.querySelector('.compactTimeStamp')
      ),
      text: C.text(body),
      bodyAvailable: isEmail ? !!emailHtml : !!expanded,
      links: isEmail ? [] : C.explicitLinks(body)
    };
  }

  function snapshot(root = document) {
    return [
      ...root.querySelectorAll(
        'article.cuf-feedItem[data-id][data-type]'
      )
    ].map(parseArticle).filter(Boolean);
  }

  function relations(root = document) {
    return C.links(
      root.querySelector('.cCaseRpdRelatedList')
    );
  }

  function scope(feed) {
    return feed.closest(
      '.oneContent,.oneRecordHomeFlexipage,.recordHomeFlexipage2'
    ) || document;
  }

  function findFeed(expected) {
    const prefix = 'qe-subject-id-';

    return [
      ...document.querySelectorAll(
        '.cuf-feed[data-feed-type="Record"]'
      )
    ].find(element =>
      C.visible(element) &&
      [...element.classList].some(name =>
        name.startsWith(prefix) &&
        name.slice(prefix.length, prefix.length + 15) ===
          expected.id.slice(0, 15)
      )
    );
  }

  function feedScroller(feed) {
  const visited = new Set();
  let waitingContainer = null;

    for (let node = feed; node && !visited.has(node);) {
      visited.add(node);

      if (
        node.nodeType === 1 &&
        C.visible(node) &&
        node.clientHeight > 0
      ) {
        const style = getComputedStyle(node);

        const scrollable =
          /(auto|scroll|overlay)/.test(style.overflowY) ||
          node.dataset?.isScrollable === 'true';

        if (scrollable) {
          if (node.scrollHeight > node.clientHeight + 5) {
            return node;
          }

          waitingContainer ||= node;
        }
      }

      node =
        node.assignedSlot ||
        node.parentElement ||
        node.getRootNode?.()?.host ||
        null;
    }

    if (waitingContainer) return waitingContainer;

    const page = document.scrollingElement;

    if (
      page &&
      page.clientHeight > 0 &&
      page.scrollHeight > page.clientHeight + 5
    ) {
      return page;
    }

    throw new Error(
      'Salesforce feed loaded, but its scrolling column could not be identified.'
    );
  }

  async function read(expected) {
    const label = C.caseNumber(expected) || 'case';

    const progress = async text => {
      await C.cancelled();

      if (C.target(location.href)?.key !== expected?.key) {
        throw new Error(
          'Salesforce navigated away from the queued case.'
        );
      }

      await chrome.storage.local.set({
        monitorProgress: `Salesforce ${label}: ${text}`
      });
    };

    const waitFeed = async () => {
      const started = Date.now();
      let clicked = false;

      while (Date.now() - started < 120000) {
        const seconds = Math.floor(
          (Date.now() - started) / 1000
        );

        await progress(
          `waiting for the visible case feed (${seconds}s / 120s)`
        );

        const feed = findFeed(expected);

        if (feed) {
          return feed;
        }

        const tabs = [
          ...document.querySelectorAll('[role="tab"]')
        ].filter(node =>
          C.visible(node) &&
          C.text(node) === 'Feed'
        );

        if (
          !clicked &&
          tabs.length === 1 &&
          tabs[0].getAttribute('aria-selected') !== 'true'
        ) {
          clicked = true;
          tabs[0].click();
        }

        await C.sleep(1000);
      }

      throw new Error(
        'No visible feed matched this Salesforce case after 120 seconds. ' +
        'The feed layout or case identity needs inspection.'
      );
    };

    let feed = await waitFeed();
    let root = scope(feed);

    const warnings = [];
    const history = new Map();
    const seen = new WeakSet();

    let unknownReplies = false;

    const allUpdates = [
      ...root.querySelectorAll('[role="tab"]')
    ].filter(node =>
      C.visible(node) &&
      C.text(node) === 'All Updates'
    );

    if (
      allUpdates.length === 1 &&
      allUpdates[0].getAttribute('aria-selected') !== 'true'
    ) {
      await progress('opening All Updates');

      allUpdates[0].click();
      await C.sleep(1500);

      feed = await waitFeed();
      root = scope(feed);
    }

    let previous = '';
    let stableSince = 0;
    let ended = false;

    const positions = new Map();
    const started = Date.now();

    let rounds = 0;

    try {
      while (
        Date.now() - started < 180000 &&
        rounds++ < 240
      ) {
        await progress(
          `reading and scrolling — ${history.size} messages collected`
        );

        const current = findFeed(expected);

        if (!current) {
          stableSince = 0;
          await C.sleep(750);
          continue;
        }

        feed = current;
        root = scope(feed);

        let scroll = feedScroller(feed);

        if (!positions.has(scroll)) {
          positions.set(scroll, scroll.scrollTop);

          scroll.scrollTop = 0;

          scroll.dispatchEvent(
            new Event('scroll', { bubbles: true })
          );

          await C.sleep(750);
          stableSince = 0;
        }

        let expanded = false;

        const controls = [
          ...feed.querySelectorAll('a,button')
        ].filter(node =>
          C.visible(node) &&
          !node.disabled &&
          !seen.has(node) &&
          /^(?:Click to expand post|Show more|View more|Load more|View all comments|Show all comments|More comments)$/i
            .test(C.text(node))
        );

        for (const button of controls.slice(0, 12)) {
          await C.cancelled();

          if (!button.isConnected) {
            continue;
          }

          seen.add(button);
          button.click();
          expanded = true;

          await C.sleep(150);
        }

        for (const message of snapshot(feed)) {
          history.set(message.id, message);
        }

        unknownReplies ||= !!feed.querySelector(
          '.forceChatterComment,.forceChatterFeedComment'
        );

        // Recheck because Salesforce may replace its scrolling container.
        scroll = feedScroller(feed);

        if (!positions.has(scroll)) {
          positions.set(scroll, scroll.scrollTop);
        }

        const busy =
          feed.matches('[aria-busy="true"]') ||
          [...feed.querySelectorAll(
            '[aria-busy="true"],[role="progressbar"],.slds-spinner'
          )].some(C.visible);

        const signature =
          JSON.stringify(
            [...history.values()].map(message => [
              message.id,
              message.date,
              message.text.length,
              message.bodyAvailable
            ])
          ) +
          `/${scroll.scrollHeight}/${scroll.scrollTop}`;

        const bottom =
          scroll.scrollTop + scroll.clientHeight >=
          scroll.scrollHeight - 5;

        if (
          bottom &&
          !busy &&
          !expanded &&
          history.size &&
          signature === previous
        ) {
          if (!stableSince) {
            stableSince = Date.now();
          }

          if (Date.now() - stableSince >= 8000) {
            ended = true;
            break;
          }
        } else {
          stableSince = 0;
        }

        previous = signature;

        const trigger = feed
        .closest('.forceChatterFeed')
        ?.querySelector('.loadMoreTrigger');

        const before = scroll.scrollTop;

        scroll.scrollTop += Math.max(
          200,
          scroll.clientHeight * 0.8
        );

        if (
          bottom &&
          trigger &&
          C.visible(trigger)
        ) {
          trigger.scrollIntoView({
            block: 'end',
            behavior: 'instant'
          });
        }

        scroll.dispatchEvent(
          new Event('scroll', { bubbles: true })
        );

        await progress(
          `${busy ? 'waiting for more messages' : 'scrolling feed'} — ` +
          `${history.size} messages; position ` +
          `${Math.round(scroll.scrollTop)} / ` +
          `${Math.max(
            0,
            Math.round(scroll.scrollHeight - scroll.clientHeight)
          )}`
        );

        if (
          !bottom &&
          scroll.scrollTop === before &&
          !busy
        ) {
          throw new Error(
            'The Salesforce feed scrolling element did not move.'
          );
        }

        await C.sleep(750);
      }
    } finally {
      for (const [node, top] of positions) {
        if (node.isConnected) {
          node.scrollTop = top;
        }
      }
    }

    await progress(
      'checking linked RPDs and preparing the case result'
    );

    const messages = [...history.values()];
    const latest = C.latest(messages);

    if (!ended) {
      warnings.push(
        'Feed scan limit reached; some older history may be missing.'
      );
    }

    const incomplete = messages.filter(
      message => !message.bodyAvailable
    ).length;

    if (incomplete) {
      warnings.push(
        `${incomplete} message(s) have only a preview available; full text was not verified.`
      );
    }

    if (unknownReplies) {
      warnings.push(
        'Nested feed replies found; this layout needs verification before choosing the latest message.'
      );
    }

    const card = root.querySelector('.cCaseRpdRelatedList');
    let related = relations(root);

    const cardContainer = card?.closest(
      'flexipage-component2'
    );

    const count = Number(
      C.text(
        cardContainer?.querySelector('[title^="Case RPDs ("]')
      ).match(/\((\d+)\)/)?.[1] || 0
    );

    if (count > related.length) {
      const button = cardContainer?.querySelector(
        'a[title="View All Case RPDs"]'
      );

      if (button) {
        button.click();
        await C.sleep(900);

        const dialog = [
          ...document.querySelectorAll('[role="dialog"]')
        ].find(element =>
          C.visible(element) &&
          /Case RPDs/.test(C.text(element))
        );

        if (dialog) {
          related = [
            ...new Map(
              [...related, ...C.links(dialog)]
                .filter(item => item.source === 'RPD')
                .map(item => [item.key, item])
            ).values()
          ];

          const close = dialog.querySelector(
            'button[title="Close"],button[aria-label="Close"]'
          );

          close?.click();
        }
      }
    }

    if (count > related.length) {
      warnings.push(
        `Case RPDs card shows ${count} records but only ${related.length} links loaded. Open View All Case RPDs to inspect the remainder.`
      );
    }

    const field = name =>
      C.text(root.querySelector(
        `[data-target-selection-name="sfdc:RecordField.Case.${name}"] .test-id__field-value`
      ));

    return {
      ...expected,
      title: field('Subject') || document.title,
      caseNumber: field('CaseNumber') || C.caseNumber(expected),
      status: field('Status'),
      messages,
      latest,

      links: [
        ...new Map(
          [
            ...related,
            ...messages.flatMap(message => message.links)
          ]
            .filter(item => item.key !== expected.key)
            .map(item => [item.key, item])
        ).values()
      ],

      error: !ended
        ? 'Salesforce feed did not reach a stable end; latest message was not verified.'
        : unknownReplies
          ? 'Nested Salesforce replies could not be verified.'
          : !latest
            ? 'Could not verify the latest Salesforce author and UTC timestamp.'
            : '',

      warnings,

      historyCoverage:
        'Loaded case feed after scrolling and expanding messages; other activity views are not assumed complete.',

      capturedAt: new Date().toISOString(),

      diagnostics: {
        feedCase: expected.id,
        messageCount: messages.length,
        previewOnly: incomplete,
        feedTypes: [
          ...new Set(
            [...feed.querySelectorAll('article[data-type]')]
              .map(element => element.dataset.type)
          )
        ]
      }
    };
  }

  globalThis.CMReaders ||= {};

  globalThis.CMReaders.salesforce = {
    version: '3.1.7',
    read,
    snapshot,
    relations
  };
})();