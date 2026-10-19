(() => {
  const $ = id => document.getElementById(id);

  let starting = false;
  let running = false;
  let refreshId = 0;

  function message(text, error = false) {
    $('runStatus').textContent = text;
    $('runStatus').classList.toggle('error', error);
  }

  function theme(value) {
    const light = value === 'light';

    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    $('themeButton').textContent = light ? '🌙' : '☀️';

    $('themeButton').setAttribute(
      'aria-label',
      light ? 'Switch to dark theme' : 'Switch to light theme'
    );
  }

  function close(id) {
    if ($(id).open) $(id).close();
  }

  function open(id) {
    if (!$(id).open) $(id).showModal();
  }

  async function refresh() {
    const id = ++refreshId;

    const settings = await chrome.storage.local.get([
      'cmJob',
      'monitorProgress',
      'monitorStopRequested',
      'lastMonitorResult',
      'lastMonitorRun',
      'cmTheme'
    ]);

    if (id !== refreshId) return;

    const job = settings.cmJob;
    const result = settings.lastMonitorResult;
    const queue = job?.queue || [];

    running = job?.status === 'running';
    theme(settings.cmTheme);

    $('runButton').disabled = running || starting;
    $('stopButton').classList.toggle('hidden', !running);
    $('stopButton').disabled = !!settings.monitorStopRequested;

    $('statusText').textContent = running
      ? settings.monitorStopRequested ? 'Stopping…' : 'Running'
      : starting
        ? 'Starting…'
        : job?.status === 'failed'
          ? 'Run failed'
          : job?.status === 'stopped'
            ? 'Stopped'
            : result?.summaryError
              ? 'Delivery failed'
              : result?.partial
                ? 'Complete — review warnings'
                : 'Ready';

    $('statusDot').dataset.state = running || starting
      ? 'running'
      : job?.status === 'failed' || result?.summaryError
        ? 'failed'
        : 'ready';

    $('lastRun').textContent = settings.lastMonitorRun
      ? 'Last completed run: ' +
        new Date(settings.lastMonitorRun).toLocaleString()
      : 'No completed run yet';

    if (running) {
      close('runDialogOverlay');

      message([
        settings.monitorProgress,
        `${job.index || 0}/${queue.length} case pages read`
      ].filter(Boolean).join('\n'));
    } else if (!starting) {
      close('stopDialogOverlay');

      message(
        result?.error || [
          settings.monitorProgress,
          result?.summarySent ? 'Report accepted by Power Automate.' : '',
          result?.summaryError
        ].filter(Boolean).join('\n'),
        !!(result?.error || result?.summaryError)
      );
    }

    $('sharePointCount').textContent = job?.sharepoint?.length || 0;

    $('rpdCount').textContent = queue.filter(
      item => item.source === 'RPD'
    ).length;

    $('salesforceCount').textContent = queue.filter(
      item => item.source === 'Salesforce'
    ).length;

    $('spinOffCount').textContent = queue.filter(
      item => (item.parents || []).some(parent => !parent.startsWith('SP:'))
    ).length;

    document.querySelector('.stats').title =
      'Counts include queued case pages.';

    $('report').textContent = result?.message || '';
  }

  async function start(sendSummary) {
    if (starting || running) return;

    starting = true;
    close('runDialogOverlay');

    $('runButton').disabled = true;
    $('statusText').textContent = 'Starting…';
    message('Starting case review…');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'RUN_MONITOR_NOW',
        sendSummary
      });

      if (!response?.success) {
        throw new Error(
          response?.error || 'Could not start the monitor.'
        );
      }
    } finally {
      starting = false;
      $('runButton').disabled = running;
    }

    await refresh();
  }

  async function records() {
    const { cmJob: job } = await chrome.storage.local.get('cmJob');

    const keys = (job?.queue || []).map(
      item => 'cmCase:' + item.key
    );

    const stored = keys.length
      ? await chrome.storage.local.get(keys)
      : {};

    return {
      job,
      cases: Object.values(stored).filter(
        item => item && item.runId === job?.id
      )
    };
  }

  function bind(id, action) {
    $(id).onclick = async () => {
      try {
        await action();
      } catch (error) {
        message('Error: ' + error.message, true);

        if (!running && !starting) {
          $('statusText').textContent = 'Ready';
        }
      }
    };
  }

  bind('settingsButton', () => chrome.runtime.openOptionsPage());

  bind('themeButton', async () => {
    const value = document.documentElement.dataset.theme === 'light'
      ? 'dark'
      : 'light';

    theme(value);
    await chrome.storage.local.set({ cmTheme: value });
  });

  bind('runButton', () => {
    if (!running && !starting) open('runDialogOverlay');
  });

  bind('cancelRunButton', () => close('runDialogOverlay'));
  bind('runWithReportButton', () => start(true));
  bind('runOnlyButton', () => start(false));

  bind('stopButton', () => {
    if (running) open('stopDialogOverlay');
  });

  bind('keepRunningButton', () => close('stopDialogOverlay'));

  bind('confirmStopButton', async () => {
    close('stopDialogOverlay');
    $('stopButton').disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'STOP_MONITOR'
      });

      if (!response?.success) {
        throw new Error(
          response?.error || 'Stop was not confirmed.'
        );
      }

      await refresh();
    } catch (error) {
      $('stopButton').disabled = false;
      throw error;
    }
  });

  bind('serviceWorkerButton', () =>
    chrome.tabs.create({
      url: 'chrome://extensions/?id=' + chrome.runtime.id
    })
  );

  bind('copyReportButton', async () => {
    const text = $('report').textContent;

    if (!text.trim()) {
      throw new Error('There is no report to copy yet.');
    }

    await navigator.clipboard.writeText(text);
    message('Report copied.');
  });

  bind('exportHistoryButton', async () => {
    const { job, cases } = await records();

    const data = {
      version: '3.1.0',
      runId: job?.id,
      sharepoint: job?.sharepoint || [],
      cases
    };

    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify(data, null, 2)],
        { type: 'application/json' }
      )
    );

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'my-case-history.json';

    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
    message('Case history export requested.');
  });

  bind('copyDiagnosticsButton', async () => {
    const { job, cases } = await records();

    const data = {
      version: '3.1.0',
      status: job?.status,
      roots: job?.rootKeys,
      cases: cases.map(item => ({
        key: item.key,
        error: item.error,
        latest: item.latest && {
          author: item.latest.author,
          date: item.latest.date
        },
        diagnostics: item.diagnostics,
        warnings: item.warnings
      }))
    };

    await navigator.clipboard.writeText(
      JSON.stringify(data, null, 2)
    );

    message('Diagnostics copied.');
  });

  for (const id of ['runDialogOverlay', 'stopDialogOverlay']) {
    $(id).addEventListener('click', event => {
      if (event.target !== $(id)) return;

      const rect = $(id).getBoundingClientRect();

      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        close(id);
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.cmTheme) {
      theme(changes.cmTheme.newValue);
    }

    if (Object.keys(changes).some(
      key => key !== 'cmTheme' && !key.startsWith('cmCase:')
    )) {
      refresh().catch(error => message(error.message, true));
    }
  });

  refresh().catch(error => message(error.message, true));
})();