/* ============================================
   语音转大字显示 - 核心逻辑
   ============================================ */

(function () {
  'use strict';

  // --- DOM 元素 ---
  const portraitMode = document.getElementById('portraitMode');
  const landscapeMode = document.getElementById('landscapeMode');
  const portraitTalkBtn = document.getElementById('portraitTalkBtn');
  const landscapeTalkBtn = document.getElementById('landscapeTalkBtn');
  const textContent = document.getElementById('textContent');
  const textDisplay = document.getElementById('textDisplay');
  const toolbar = document.getElementById('toolbar');
  const exitBtn = document.getElementById('exitBtn');
  const clearBtn = document.getElementById('clearBtn');
  const recordingOverlay = document.getElementById('recordingOverlay');
  const unsupportedModal = document.getElementById('unsupportedModal');
  const portraitLangSwitch = document.getElementById('portraitLangSwitch');
  const landscapeLangSwitch = document.getElementById('landscapeLangSwitch');

  // --- 状态 ---
  let currentLang = 'zh-CN';
  let isRecording = false;
  let isLandscapeMode = false;
  let recognition = null;
  let hasText = false;
  let toolbarTimer = null;
  let pendingStop = false;

  // --- 浏览器兼容性检查 ---
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    unsupportedModal.classList.remove('hidden');
    return;
  }

  // --- 初始化语音识别 ---
  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.lang = currentLang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = handleResult;
    rec.onerror = handleError;
    rec.onend = handleEnd;

    return rec;
  }

  // --- 语音识别结果处理 ---
  function handleResult(event) {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      appendFinalText(finalTranscript);
    }

    if (interimTranscript) {
      showInterimText(interimTranscript);
    }
  }

  function handleError(event) {
    console.warn('语音识别错误:', event.error);

    if (event.error === 'not-allowed') {
      showToast('请允许使用麦克风权限');
    } else if (event.error === 'no-speech') {
      showToast('未检测到语音，请重试');
    } else if (event.error === 'network') {
      showToast('网络连接失败，请检查网络');
    }

    stopRecording();
  }

  function handleEnd() {
    if (isRecording) {
      stopRecording();
    }

    if (pendingStop) {
      pendingStop = false;
      if (!isLandscapeMode && hasText) {
        enterLandscapeMode();
      }
    }
  }

  // --- 文字显示 ---
  function clearPlaceholder() {
    const placeholder = textContent.querySelector('.placeholder-text');
    if (placeholder) {
      placeholder.remove();
    }
  }

  function appendFinalText(text) {
    clearPlaceholder();
    hasText = true;

    removeInterimElement();

    const p = document.createElement('p');
    p.className = 'text-line';
    p.textContent = text;
    textContent.appendChild(p);

    scrollToBottom();
  }

  function showInterimText(text) {
    clearPlaceholder();

    let interimEl = textContent.querySelector('.text-line.interim');
    if (!interimEl) {
      interimEl = document.createElement('p');
      interimEl.className = 'text-line interim';
      textContent.appendChild(interimEl);
    }
    interimEl.textContent = text;

    scrollToBottom();
  }

  function removeInterimElement() {
    const interimEl = textContent.querySelector('.text-line.interim');
    if (interimEl) {
      interimEl.remove();
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      textDisplay.scrollTop = textDisplay.scrollHeight;
    });
  }

  function clearText() {
    textContent.innerHTML = '<p class="placeholder-text">等待语音输入...</p>';
    hasText = false;
  }

  // --- 录音控制 ---
  function startRecording(talkBtn) {
    if (isRecording) return;

    isRecording = true;
    talkBtn.classList.add('recording');
    talkBtn.querySelector('.btn-text').textContent = '松开结束';

    if (isLandscapeMode) {
      recordingOverlay.classList.remove('hidden');
      showToolbar();
    }

    recognition = createRecognition();

    try {
      recognition.start();
    } catch (e) {
      console.warn('启动识别失败:', e);
      stopRecording();
    }
  }

  function stopRecording() {
    if (!isRecording && !recognition) return;

    isRecording = false;

    portraitTalkBtn.classList.remove('recording');
    landscapeTalkBtn.classList.remove('recording');
    portraitTalkBtn.querySelector('.btn-text').textContent = '长按说话';
    landscapeTalkBtn.querySelector('.btn-text').textContent = '长按说话';

    recordingOverlay.classList.add('hidden');

    removeInterimElement();

    if (recognition) {
      pendingStop = true;
      try {
        recognition.stop();
      } catch (e) {
        pendingStop = false;
      }
      recognition = null;
    }
  }

  // --- 模式切换 ---
  function enterLandscapeMode() {
    isLandscapeMode = true;
    portraitMode.classList.add('hidden');
    landscapeMode.classList.remove('hidden');

    enterFullscreen();
    startToolbarAutoHide();
  }

  function exitLandscapeMode() {
    isLandscapeMode = false;
    landscapeMode.classList.add('hidden');
    portraitMode.classList.remove('hidden');

    exitFullscreen();
    clearToolbarTimer();
  }

  // --- 全屏控制 ---
  function enterFullscreen() {
    const el = document.documentElement;

    const requestFS =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;

    if (requestFS) {
      requestFS.call(el).then(() => {
        lockLandscape();
      }).catch(() => {
        lockLandscape();
      });
    }
  }

  function exitFullscreen() {
    const exitFS =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;

    if (exitFS && document.fullscreenElement) {
      exitFS.call(document).catch(() => {});
    }

    unlockOrientation();
  }

  function lockLandscape() {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {
        // iOS 等不支持时静默失败
      });
    }
  }

  function unlockOrientation() {
    if (screen.orientation && screen.orientation.unlock) {
      try {
        screen.orientation.unlock();
      } catch (e) {
        // 静默
      }
    }
  }

  // 监听全屏状态变化，用户按返回键退出全屏时同步状态
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  function onFullscreenChange() {
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFS && isLandscapeMode) {
      isLandscapeMode = false;
      landscapeMode.classList.add('hidden');
      portraitMode.classList.remove('hidden');
      clearToolbarTimer();
      unlockOrientation();
    }
  }

  // --- 工具栏自动隐藏 ---
  function startToolbarAutoHide() {
    clearToolbarTimer();
    toolbar.classList.remove('fade-out');
    toolbarTimer = setTimeout(() => {
      if (!isRecording) {
        toolbar.classList.add('fade-out');
      }
    }, 4000);
  }

  function showToolbar() {
    toolbar.classList.remove('fade-out');
    startToolbarAutoHide();
  }

  function clearToolbarTimer() {
    if (toolbarTimer) {
      clearTimeout(toolbarTimer);
      toolbarTimer = null;
    }
  }

  // 点击展示区域时显示工具栏
  textDisplay.addEventListener('click', () => {
    if (isLandscapeMode) {
      showToolbar();
    }
  });

  // --- 语言切换 ---
  function setLang(lang) {
    currentLang = lang;

    document.querySelectorAll('.lang-switch').forEach(switchEl => {
      switchEl.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
      });
    });
  }

  function initLangSwitch(switchEl) {
    switchEl.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        setLang(btn.dataset.lang);
      });
    });
  }

  initLangSwitch(portraitLangSwitch);
  initLangSwitch(landscapeLangSwitch);

  // --- 长按按钮事件绑定 ---
  function bindTalkButton(btn) {
    let touchStarted = false;

    // 触摸事件（移动端）
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchStarted = true;
      startRecording(btn);
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (touchStarted) {
        touchStarted = false;
        stopRecording();
      }
    }, { passive: false });

    btn.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      if (touchStarted) {
        touchStarted = false;
        stopRecording();
      }
    }, { passive: false });

    // 鼠标事件（桌面端）
    btn.addEventListener('mousedown', (e) => {
      if (touchStarted) return;
      e.preventDefault();
      startRecording(btn);
    });

    btn.addEventListener('mouseup', (e) => {
      if (touchStarted) return;
      e.preventDefault();
      stopRecording();
    });

    btn.addEventListener('mouseleave', (e) => {
      if (touchStarted) return;
      if (isRecording) {
        stopRecording();
      }
    });

    // 阻止长按弹出菜单
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  bindTalkButton(portraitTalkBtn);
  bindTalkButton(landscapeTalkBtn);

  // --- 工具栏按钮 ---
  exitBtn.addEventListener('click', () => {
    exitLandscapeMode();
  });

  clearBtn.addEventListener('click', () => {
    clearText();
    showToolbar();
  });

  // --- Toast 提示 ---
  function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.style.cssText = 'position:fixed;bottom:20%;left:50%;transform:translateX(-50%);' +
        'background:rgba(0,0,0,0.8);color:#fff;padding:12px 24px;border-radius:25px;' +
        'font-size:1rem;z-index:9999;transition:opacity 0.3s;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  }

  // --- 阻止页面默认手势 ---
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());

})();
