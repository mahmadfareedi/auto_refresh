const AUTO_REFRESH_STORAGE_KEY = 'autoRefreshTabs';
const BADGE_BACKGROUND_COLOR = '#4338CA';
const BADGE_TEXT_COLOR = '#F9FAFB';

const autoRefreshTabs = new Map(); // tabId -> { intervalSeconds, remainingSeconds }

(async () => {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND_COLOR });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
    }
  } catch (error) {
    console.warn('Failed to set badge colors', error);
  }
})();

const formatBadgeText = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0';
  }

  if (seconds >= 100) {
    return '99+';
  }

  return `${seconds}`;
};

const setBadgeForTab = async (tabId, seconds) => {
  try {
    const rounded = Math.max(0, Math.round(seconds || 0));
    const text = formatBadgeText(rounded);
    await chrome.action.setBadgeText({ tabId, text });
  } catch (error) {
    console.error('Failed to set badge text for tab', tabId, error);
  }
};

const clearBadgeForTab = async (tabId) => {
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch (error) {
    console.error('Failed to clear badge text for tab', tabId, error);
  }
};

const clearCache = async () => {
  await chrome.browsingData.remove(
    { since: 0 },
    {
      cache: true,
      cacheStorage: true
    }
  );
};

const persistAutoRefreshState = async () => {
  const serialized = {};
  for (const [tabId, data] of autoRefreshTabs.entries()) {
    serialized[tabId] = data.intervalSeconds;
  }

  await chrome.storage.local.set({ [AUTO_REFRESH_STORAGE_KEY]: serialized });
};

const clearAutoRefreshOnTab = async (tabId) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__refreshAppIntervalId) {
          clearInterval(window.__refreshAppIntervalId);
          delete window.__refreshAppIntervalId;
        }
        if (window.__refreshAppWindowListener) {
          window.removeEventListener('load', window.__refreshAppWindowListener);
          delete window.__refreshAppWindowListener;
        }
      }
    });
  } catch (error) {
    console.error('Failed to clear auto refresh interval on tab', tabId, error);
  }
};

const applyAutoRefreshToTab = async (tabId, intervalSeconds) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (seconds, refreshTabId) => {
        const installTimer = () => {
          const totalSeconds = Math.max(1, Number(seconds) || 1);

          if (window.__refreshAppIntervalId) {
            clearInterval(window.__refreshAppIntervalId);
          }

          let remaining = totalSeconds;

          const notify = () => {
            try {
              chrome.runtime.sendMessage({ type: 'AUTO_REFRESH_TICK', tabId: refreshTabId, remaining });
            } catch (error) {
              // ignore temporary messaging errors
            }
          };

          notify();

          window.__refreshAppIntervalId = setInterval(() => {
            remaining -= 1;

            if (remaining <= 0) {
              remaining = 0;
              notify();
              clearInterval(window.__refreshAppIntervalId);
              delete window.__refreshAppIntervalId;
              window.location.reload();
              return;
            }

            notify();
          }, 1000);
        };

        const startWhenReady = () => {
          installTimer();
          if (window.__refreshAppWindowListener) {
            delete window.__refreshAppWindowListener;
          }
        };

        if (document.readyState === 'complete') {
          startWhenReady();
        } else {
          window.__refreshAppWindowListener = startWhenReady;
          window.addEventListener('load', startWhenReady, { once: true });
        }
      },
      args: [intervalSeconds, tabId]
    });
  } catch (error) {
    console.error('Failed to apply auto refresh to tab', tabId, error);
  }
};

const restoreAutoRefreshState = async () => {
  try {
    const stored = await chrome.storage.local.get(AUTO_REFRESH_STORAGE_KEY);
    const serialized = stored[AUTO_REFRESH_STORAGE_KEY] || {};

    for (const [tabIdString, intervalSeconds] of Object.entries(serialized)) {
      const tabId = Number(tabIdString);
      if (Number.isNaN(tabId)) {
        continue;
      }

      const state = { intervalSeconds, remainingSeconds: intervalSeconds };
      autoRefreshTabs.set(tabId, state);

      try {
        await chrome.tabs.get(tabId);
        await setBadgeForTab(tabId, state.remainingSeconds);
        await applyAutoRefreshToTab(tabId, intervalSeconds);
      } catch (error) {
        autoRefreshTabs.delete(tabId);
        await clearBadgeForTab(tabId);
        console.warn('Removing stale auto refresh entry for closed tab', tabId);
      }
    }

    await persistAutoRefreshState();
  } catch (error) {
    console.error('Failed to restore auto refresh state', error);
  }
};

chrome.runtime.onStartup.addListener(restoreAutoRefreshState);
chrome.runtime.onInstalled.addListener(restoreAutoRefreshState);
restoreAutoRefreshState().catch((error) => {
  console.error('Failed to initialize auto refresh state', error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && autoRefreshTabs.has(tabId)) {
    const state = autoRefreshTabs.get(tabId);
    state.remainingSeconds = state.intervalSeconds;
    setBadgeForTab(tabId, state.remainingSeconds);
    applyAutoRefreshToTab(tabId, state.intervalSeconds);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (autoRefreshTabs.has(tabId)) {
    autoRefreshTabs.delete(tabId);
    await persistAutoRefreshState();
    await clearBadgeForTab(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = (payload) => {
    try {
      sendResponse(payload);
    } catch (error) {
      console.error('Failed to send response', error);
    }
  };

  const handle = async () => {
    const { type } = message;
    let { tabId } = message;

    if ((tabId === undefined || tabId === null) && sender?.tab?.id !== undefined) {
      tabId = sender.tab.id;
    }

    if ((tabId === undefined || tabId === null) && type !== 'AUTO_REFRESH_TICK') {
      respond({ success: false, error: 'Missing active tab id.' });
      return;
    }

    try {
      switch (type) {
        case 'HARD_REFRESH': {
          await clearCache();
          await chrome.tabs.reload(tabId, { bypassCache: true });
          respond({ success: true });
          break;
        }
        case 'NORMAL_REFRESH': {
          await chrome.tabs.reload(tabId, { bypassCache: false });
          respond({ success: true });
          break;
        }
        case 'START_AUTO_REFRESH': {
          const intervalSeconds = Math.max(1, Number(message.intervalSeconds) || 0);
          const state = autoRefreshTabs.get(tabId) || {};
          state.intervalSeconds = intervalSeconds;
          state.remainingSeconds = intervalSeconds;
          autoRefreshTabs.set(tabId, state);
          await persistAutoRefreshState();
          await setBadgeForTab(tabId, state.remainingSeconds);
          await applyAutoRefreshToTab(tabId, intervalSeconds);
          respond({ success: true, intervalSeconds });
          break;
        }
        case 'STOP_AUTO_REFRESH': {
          await clearAutoRefreshOnTab(tabId);
          autoRefreshTabs.delete(tabId);
          await persistAutoRefreshState();
          await clearBadgeForTab(tabId);
          respond({ success: true });
          break;
        }
        case 'GET_AUTO_REFRESH_STATE': {
          const info = autoRefreshTabs.get(tabId) || null;
          respond({
            success: true,
            isAutoRefreshing: autoRefreshTabs.has(tabId),
            intervalSeconds: info ? info.intervalSeconds : null,
            remainingSeconds: info ? info.remainingSeconds : null
          });
          break;
        }
        case 'AUTO_REFRESH_TICK': {
          if (tabId === undefined || tabId === null) {
            respond({ success: false, error: 'Unable to determine tab for tick.' });
            break;
          }

          const state = autoRefreshTabs.get(tabId);
          if (!state) {
            respond({ success: false, error: 'No auto refresh active for tab.' });
            break;
          }

          const numericRemaining = Number(message.remaining);
          const remaining = Number.isFinite(numericRemaining) ? Math.max(0, numericRemaining) : state.intervalSeconds;
          state.remainingSeconds = remaining;
          await setBadgeForTab(tabId, state.remainingSeconds);
          respond({ success: true });
          break;
        }
        default:
          respond({ success: false, error: `Unsupported message type: ${type}` });
      }
    } catch (error) {
      console.error('Error handling message', type, error);
      respond({ success: false, error: error?.message || 'Unexpected error.' });
    }
  };

  handle();
  return true;
});
