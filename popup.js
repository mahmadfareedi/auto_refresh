const hardRefreshBtn = document.getElementById('hard-refresh');
const normalRefreshBtn = document.getElementById('normal-refresh');
const toggleAutoBtn = document.getElementById('toggle-auto');
const intervalInput = document.getElementById('interval-input');
const statusChip = document.getElementById('status-chip');
const presetButtons = Array.from(document.querySelectorAll('.preset'));
const messageEl = document.getElementById('message');
const shortcutBtn = document.getElementById('shortcut-btn');

let activeTabId = null;
let isAutoRefreshing = false;
let currentIntervalSeconds = 5;
let messageTimeout = null;

const showMessage = (text, type = 'success') => {
  if (!messageEl) {
    return;
  }

  messageEl.textContent = text;
  messageEl.classList.remove('success', 'error');
  messageEl.classList.add(type === 'success' ? 'success' : 'error');
  messageEl.hidden = false;

  if (messageTimeout) {
    clearTimeout(messageTimeout);
  }

  messageTimeout = setTimeout(() => {
    messageEl.hidden = true;
  }, 3200);
};

const updateStatusUI = () => {
  statusChip.textContent = isAutoRefreshing ? `Auto ${currentIntervalSeconds}s` : 'Auto Off';
  statusChip.classList.toggle('status-on', isAutoRefreshing);
  statusChip.classList.toggle('status-off', !isAutoRefreshing);

  toggleAutoBtn.textContent = isAutoRefreshing ? 'Stop Auto Refresh' : 'Start Auto Refresh';
  toggleAutoBtn.classList.toggle('active', isAutoRefreshing);
  toggleAutoBtn.setAttribute('aria-pressed', String(isAutoRefreshing));
};

const updatePresets = (interval) => {
  presetButtons.forEach((button) => {
    const value = Number.parseInt(button.dataset.interval, 10);
    button.classList.toggle('active', value === interval);
  });
};

const parseInterval = () => {
  const raw = intervalInput.value.trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Enter 1 second or more.');
  }
  return parsed;
};

const sendCommand = async (type, extra = {}) => {
  if (activeTabId === null) {
    throw new Error('No active tab selected.');
  }

  try {
    return await chrome.runtime.sendMessage({
      type,
      tabId: activeTabId,
      ...extra
    });
  } catch (error) {
    throw new Error(error?.message || 'Unable to reach background script.');
  }
};

const startAutoRefresh = async (intervalSeconds) => {
  const response = await sendCommand('START_AUTO_REFRESH', { intervalSeconds });
  if (!response?.success) {
    throw new Error(response?.error || 'Unable to start auto refresh.');
  }

  currentIntervalSeconds = response.intervalSeconds || intervalSeconds;
  isAutoRefreshing = true;
  updateStatusUI();
  updatePresets(currentIntervalSeconds);
};

const stopAutoRefresh = async () => {
  const response = await sendCommand('STOP_AUTO_REFRESH');
  if (!response?.success) {
    throw new Error(response?.error || 'Unable to stop auto refresh.');
  }

  isAutoRefreshing = false;
  updateStatusUI();
};

const loadInitialState = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) {
    throw new Error('Unable to find the current tab.');
  }

  activeTabId = tab.id;
  const response = await sendCommand('GET_AUTO_REFRESH_STATE');

  if (response?.success) {
    isAutoRefreshing = Boolean(response.isAutoRefreshing);
    if (response.intervalSeconds) {
      currentIntervalSeconds = response.intervalSeconds;
      intervalInput.value = response.intervalSeconds;
    }
    updatePresets(currentIntervalSeconds);
    updateStatusUI();
  } else if (response?.error) {
    throw new Error(response.error);
  }
};

const handleHardRefresh = async () => {
  try {
    const response = await sendCommand('HARD_REFRESH');
    if (!response?.success) {
      throw new Error(response?.error || 'Failed to hard refresh.');
    }
    showMessage('Hard refresh triggered.', 'success');
  } catch (error) {
    showMessage(error.message || 'Failed to hard refresh.', 'error');
  }
};

const handleNormalRefresh = async () => {
  try {
    const response = await sendCommand('NORMAL_REFRESH');
    if (!response?.success) {
      throw new Error(response?.error || 'Failed to refresh tab.');
    }
    showMessage('Tab refreshed.', 'success');
  } catch (error) {
    showMessage(error.message || 'Failed to refresh tab.', 'error');
  }
};

const handleToggleAuto = async () => {
  try {
    if (isAutoRefreshing) {
      await stopAutoRefresh();
      showMessage('Auto refresh stopped.', 'success');
      return;
    }

    const intervalSeconds = parseInterval();
    await startAutoRefresh(intervalSeconds);
    showMessage(`Auto refresh every ${currentIntervalSeconds}s.`, 'success');
  } catch (error) {
    showMessage(error.message || 'Failed to update auto refresh.', 'error');
    if (!isAutoRefreshing) {
      intervalInput.focus();
    }
  }
};

const handlePresetClick = async (event) => {
  const button = event.currentTarget;
  const intervalSeconds = Number.parseInt(button.dataset.interval || '', 10);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1) {
    return;
  }

  intervalInput.value = intervalSeconds;
  currentIntervalSeconds = intervalSeconds;
  updatePresets(intervalSeconds);

  if (isAutoRefreshing) {
    try {
      await startAutoRefresh(intervalSeconds);
      showMessage(`Auto refresh set to ${intervalSeconds}s.`, 'success');
    } catch (error) {
      showMessage(error.message || 'Failed to update auto refresh.', 'error');
    }
  }
};

const handleIntervalChange = async () => {
  try {
    const intervalSeconds = parseInterval();
    currentIntervalSeconds = intervalSeconds;
    updatePresets(intervalSeconds);

    if (isAutoRefreshing) {
      await startAutoRefresh(intervalSeconds);
      showMessage(`Auto refresh set to ${intervalSeconds}s.`, 'success');
    }
  } catch (error) {
    showMessage(error.message || 'Enter a valid interval.', 'error');
  }
};

const init = async () => {
  try {
    await loadInitialState();
  } catch (error) {
    showMessage(error.message || 'Extension cannot access this tab.', 'error');
    hardRefreshBtn.disabled = true;
    normalRefreshBtn.disabled = true;
    toggleAutoBtn.disabled = true;
    intervalInput.disabled = true;
    presetButtons.forEach((button) => {
      button.disabled = true;
    });
  }
};

hardRefreshBtn.addEventListener('click', handleHardRefresh);
normalRefreshBtn.addEventListener('click', handleNormalRefresh);
toggleAutoBtn.addEventListener('click', handleToggleAuto);
intervalInput.addEventListener('change', handleIntervalChange);
presetButtons.forEach((button) => button.addEventListener('click', handlePresetClick));

document.addEventListener('DOMContentLoaded', init);

const openShortcutSettings = async () => {
  try {
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  } catch (error) {
    showMessage('Open chrome://extensions/shortcuts in the address bar.', 'error');
  }
};

if (shortcutBtn) {
  shortcutBtn.addEventListener('click', openShortcutSettings);
}
