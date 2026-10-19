(() => {
  if (globalThis.CMReaders?.rpd?.version === '3.1.4') {
    return;
  }

  const C = CM;

  function snapshot(root = document) {
    return [...root.querySelectorAll('.reply')]
      .filter(element =>
        element.querySelector('[id^="msgContent_"]')
      )
      .map(element => {
        const header = element.querySelector('.replyHeader');

        const author = header?.querySelector(
          '.comment-author'
        );

        const person = author?.querySelector(
          '[type="employee"],[type="client"],[type="Service"],[type="service"]'
        );

        const id =
          author?.dataset.messagekey ||
          element.dataset.messagekey;

        const body = element.querySelector(
          '[id^="msgContent_"]'
        );

        const raw = header
          ?.querySelector('.created-date .date[defaultvalue]')
          ?.getAttribute('defaultvalue');

        const date = raw
          ? raw.trim().replace(' ', 'T')
          : '';

        const color = (
          header?.style.backgroundColor || ''
        )
          .replace(/\s/g, '')
          .toLowerCase();

        const resolutionHeader =
          color === '#f0fff0' ||
          color === 'rgb(240,255,240)' ||
          color === 'rgba(240,255,240,1)';

        return {
          id,

          author: C.text(
            person?.querySelector('[data-individual-id]') ||
            person
          ),

          authorType:
            person?.getAttribute('type') ||
            'unknown',

          authorId:
            person?.getAttribute('data-employee-id') ||
            person?.getAttribute('data') ||
            '',

          authorEmail:
            person?.getAttribute('data-email') ||
            '',

          date,
          resolutionHeader,
          text: C.text(body),
          links: C.explicitLinks(body),
          bodyAvailable: !!body
        };
      });
  }

  function relations(root = document, currentKey = '') {
    const panel = root.querySelector(
      '.propertiesBox.linkedRPDs'
    );

    return C.links(panel).filter(
      item => item.key !== currentKey
    );
  }

  async function read(expected) {
    const current = C.target(location.href);

    if (!current || current.key !== expected?.key) {
      throw new Error(
        'RPD URL does not match the queued case.'
      );
    }

    await C.waitFor(
      () => document.querySelector(
        '.reply [id^="msgContent_"]'
      )
    );

    const warnings = [];

    // Read the thread before opening Properties.
    await C.expand(
      document.querySelector('#summaryContent') || document,
      /^(?:show|load|view) (?:all|more|older) (?:comments|replies|messages)$/i
    );

    const beforeProperties = snapshot();

    try {
      const show = document.querySelector(
        '#showProperties'
      );

      if (C.visible(show)) {
        show.click();
        await C.sleep(500);
      }

      let panel;

      try {
        panel = await C.waitFor(
          () => document.querySelector(
            '.propertiesBox.linkedRPDs'
          ),
          7000
        );
      } catch {
        warnings.push(
          'Linked/Duplicate properties panel unavailable.'
        );
      }

      if (panel) {
        const content = panel.querySelector(
          ':scope > .content'
        );

        if (content?.classList.contains('hidden')) {
          panel.querySelector('.header')?.click();
          await C.sleep(500);
        }
      }

      await C.expand(
        document.querySelector('#summaryContent') || document,
        /^(?:show|load|view) (?:all|more|older) (?:comments|replies|messages)$/i
      );

      await C.cancelled();

      const merged = new Map();

      for (const message of [
        ...beforeProperties,
        ...snapshot()
      ]) {
        const key =
          message.id ||
          `${message.date}/${message.author}/${message.text}`;

        merged.set(key, message);
      }

      const messages = [...merged.values()];
      const latest = C.latest(messages);

      const currentStatus =
        document.querySelector('#status')
          ?.getAttribute('status') ||
        '';

      // An explicit current status wins after reopening.
      // If unavailable, use only the latest verified green header.
      // Never infer resolution from message wording.
      const status = currentStatus ||
        (
          latest?.resolutionHeader
            ? 'Resolved'
            : ''
        );

      const related = new Map();

      for (const item of [
        ...relations(document, current.key),
        ...messages.flatMap(message => message.links)
      ]) {
        if (item.key !== current.key) {
          related.set(item.key, item);
        }
      }

      const counts = panel
        ? ['linkRPDCount', 'duplicateRPDCount'].map(
            id =>
              Number(
                C.text(panel.querySelector('#' + id))
              ) || 0
          )
        : [];

      if (
        counts.reduce((a, b) => a + b, 0) >
        relations(document, current.key).length
      ) {
        warnings.push(
          'Not all counted Linked/Duplicate RPDs were loaded.'
        );
      }

      if (!messages.length || !latest) {
        warnings.push(
          'RPD message headers could not be fully verified.'
        );
      }

      return {
        ...current,

        title:
          C.text(
            document.querySelector('#summaryLinkControl')
              ?.getAttribute('data-title')
          ) || document.title,

        status,
        messages,
        latest,
        links: [...related.values()],
        warnings,

        error: !latest
          ? 'Could not verify the latest RPD author and timestamp.'
          : '',

        historyCoverage:
          'All message bodies present in the loaded summary, including collapsed bodies.',

        capturedAt: new Date().toISOString(),

        diagnostics: {
          messageCount: messages.length,
          linkedCounts: counts,

          unverifiedHeaders: messages
            .filter(message =>
              !message.author ||
              C.stamp(message.date) === null
            )
            .map(message => ({
              id: message.id,
              author: message.author,
              date: message.date
            }))
        }
      };
    } finally {
      // Cleanup also runs after Stop or a reading error.
      try {
        const hide = document.querySelector(
          '#hideProperties'
        );

        const show = document.querySelector(
          '#showProperties'
        );

        const toggle = C.visible(hide)
          ? hide
          : (
              C.visible(show) &&
              show.getAttribute('aria-expanded') === 'true'
            )
            ? show
            : null;

        if (toggle) {
          toggle.click();

          const deadline = Date.now() + 3000;

          while (Date.now() < deadline) {
            const hideNow = document.querySelector(
              '#hideProperties'
            );

            const showNow = document.querySelector(
              '#showProperties'
            );

            if (
              !C.visible(hideNow) &&
              C.visible(showNow) &&
              showNow.getAttribute('aria-expanded') !== 'true'
            ) {
              break;
            }

            await C.sleep(100);
          }

          if (
            C.visible(
              document.querySelector('#hideProperties')
            ) ||
            document.querySelector('#showProperties')
              ?.getAttribute('aria-expanded') === 'true'
          ) {
            warnings.push(
              'RPD was read, but Properties could not be hidden automatically.'
            );
          }
        }
      } catch (error) {
        warnings.push(
          `Could not hide RPD Properties: ${error.message}`
        );
      }
    }
  }

  globalThis.CMReaders ||= {};

  globalThis.CMReaders.rpd = {
    version: '3.1.4',
    read,
    snapshot,
    relations
  };
})();