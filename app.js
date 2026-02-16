/* ============================================
   语音转大字显示 - 核心逻辑
   ============================================ */

(function () {
  'use strict';

  // --- DOM 元素 ---
  var portraitMode = document.getElementById('portraitMode');
  var landscapeMode = document.getElementById('landscapeMode');
  var portraitTalkBtn = document.getElementById('portraitTalkBtn');
  var landscapeTalkBtn = document.getElementById('landscapeTalkBtn');
  var textContent = document.getElementById('textContent');
  var textDisplay = document.getElementById('textDisplay');
  var toolbar = document.getElementById('toolbar');
  var exitBtn = document.getElementById('exitBtn');
  var clearBtn = document.getElementById('clearBtn');
  var recordingOverlay = document.getElementById('recordingOverlay');
  var unsupportedModal = document.getElementById('unsupportedModal');
  var portraitLangSwitch = document.getElementById('portraitLangSwitch');
  var landscapeLangSwitch = document.getElementById('landscapeLangSwitch');

  // --- 状态 ---
  var currentLang = 'zh-CN';
  var isRecording = false;
  var isLandscapeMode = false;
  var recognition = null;
  var hasText = false;
  var toolbarTimer = null;

  // 每次录音会话的文字累积
  var sessionFinalText = '';
  var sessionInterimText = '';

  // --- 浏览器兼容性检查 ---
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    unsupportedModal.classList.remove('hidden');
    return;
  }

  // --- 初始化语音识别 ---
  function createRecognition() {
    var rec = new SpeechRecognition();
    rec.lang = currentLang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = handleResult;
    rec.onerror = handleError;
    rec.onend = handleEnd;

    return rec;
  }

  // --- 语音识别结果处理 ---
  // continuous 模式下，遍历所有 results 重新拼接，确保文字不丢失
  function handleResult(event) {
    var finalText = '';
    var interimText = '';

    for (var i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
      } else {
        interimText += event.results[i][0].transcript;
      }
    }

    sessionFinalText = finalText;
    sessionInterimText = interimText;

    // 实时更新当前会话的显示（只用一个元素）
    updateSessionLine(sessionFinalText + sessionInterimText, interimText.length > 0);
  }

  function handleError(event) {
    console.warn('[语音] 识别错误:', event.error);

    if (event.error === 'not-allowed') {
      showToast('请允许使用麦克风权限');
    } else if (event.error === 'no-speech') {
      showToast('未检测到语音，请重试');
    } else if (event.error === 'network') {
      showToast('网络连接失败，请检查网络');
    } else if (event.error === 'aborted') {
      // 用户主动停止，不提示
    }
  }

  function handleEnd() {
    console.log('[语音] 识别引擎结束, isRecording:', isRecording);

    if (isRecording) {
      finishRecording();
    }
  }

  // --- 文字显示 ---
  function clearPlaceholder() {
    var placeholder = textContent.querySelector('.placeholder-text');
    if (placeholder) {
      placeholder.remove();
    }
  }

  // 更新当前录音会话的实时显示行（始终只有一个元素）
  function updateSessionLine(text, isInterim) {
    if (!text) return;
    clearPlaceholder();

    var el = textContent.querySelector('.session-line');
    if (!el) {
      el = document.createElement('p');
      el.className = 'text-line session-line';
      textContent.appendChild(el);
    }

    el.textContent = text;

    if (isInterim) {
      el.classList.add('interim');
    } else {
      el.classList.remove('interim');
    }

    scrollToBottom();
  }

  // 将当前会话行固化为历史行
  function finalizeSessionLine() {
    var fullText = (sessionFinalText + sessionInterimText).trim();

    // 移除会话行
    var sessionEl = textContent.querySelector('.session-line');
    if (sessionEl) {
      sessionEl.remove();
    }

    if (fullText) {
      clearPlaceholder();
      hasText = true;

      var p = document.createElement('p');
      p.className = 'text-line';
      p.textContent = fullText;
      textContent.appendChild(p);

      scrollToBottom();
    }

    sessionFinalText = '';
    sessionInterimText = '';
  }

  function scrollToBottom() {
    requestAnimationFrame(function () {
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
    sessionFinalText = '';
    sessionInterimText = '';
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
      console.warn('[语音] 启动识别失败:', e);
      isRecording = false;
      resetButtonUI();
      showToast('启动识别失败，请重试');
    }
  }

  function finishRecording() {
    if (!isRecording) return;

    isRecording = false;

    // 将当前会话文字固化
    finalizeSessionLine();

    resetButtonUI();
    recordingOverlay.classList.add('hidden');

    // 停止识别引擎
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
      recognition = null;
    }

    // 切换到展示模式
    if (!isLandscapeMode && hasText) {
      enterLandscapeMode();
    } else if (!hasText) {
      showToast('未检测到语音，请重试');
    }
  }

  function resetButtonUI() {
    portraitTalkBtn.classList.remove('recording');
    landscapeTalkBtn.classList.remove('recording');
    portraitTalkBtn.querySelector('.btn-text').textContent = '长按说话';
    landscapeTalkBtn.querySelector('.btn-text').textContent = '长按说话';
  }

  // --- 模式切换 ---
  function enterLandscapeMode() {
    isLandscapeMode = true;
    portraitMode.classList.add('hidden');
    landscapeMode.classList.remove('hidden');

    // 尝试原生全屏 + 横屏锁定
    tryFullscreenAndLock();

    // CSS 强制横屏（作为兜底，所有设备都生效）
    applyForceLandscape();

    startToolbarAutoHide();
  }

  function exitLandscapeMode() {
    isLandscapeMode = false;
    landscapeMode.classList.add('hidden');
    portraitMode.classList.remove('hidden');

    removeForceLandscape();
    tryExitFullscreen();
    clearToolbarTimer();
  }

  // --- CSS 强制横屏 ---
  function applyForceLandscape() {
    // 检测当前是否竖屏
    if (window.innerHeight > window.innerWidth) {
      landscapeMode.classList.add('force-landscape');
    }

    // 监听屏幕旋转，动态调整
    window.addEventListener('resize', onResizeForLandscape);
  }

  function removeForceLandscape() {
    landscapeMode.classList.remove('force-landscape');
    window.removeEventListener('resize', onResizeForLandscape);
  }

  function onResizeForLandscape() {
    if (!isLandscapeMode) return;

    if (window.innerHeight > window.innerWidth) {
      landscapeMode.classList.add('force-landscape');
    } else {
      landscapeMode.classList.remove('force-landscape');
    }
  }

  // --- 全屏控制 ---
  function tryFullscreenAndLock() {
    var el = document.documentElement;
    var requestFS = el.requestFullscreen || el.webkitRequestFullscreen;

    if (requestFS) {
      try {
        var result = requestFS.call(el);
        if (result && result.then) {
          result.then(function () {
            lockLandscape();
          }).catch(function () {});
        }
      } catch (e) {}
    }
  }

  function tryExitFullscreen() {
    var fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsElement) return;

    var exitFS = document.exitFullscreen || document.webkitExitFullscreen;
    if (exitFS) {
      try {
        var result = exitFS.call(document);
        if (result && result.catch) { result.catch(function () {}); }
      } catch (e) {}
    }

    unlockOrientation();
  }

  function lockLandscape() {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(function () {});
    }
  }

  function unlockOrientation() {
    if (screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch (e) {}
    }
  }

  // 全屏状态变化
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  function onFullscreenChange() {
    var isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFS && isLandscapeMode) {
      // 用户通过系统手势退出全屏时，也退出展示模式
      exitLandscapeMode();
    }
  }

  // --- 工具栏自动隐藏 ---
  function startToolbarAutoHide() {
    clearToolbarTimer();
    toolbar.classList.remove('fade-out');
    toolbarTimer = setTimeout(function () {
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

  textDisplay.addEventListener('click', function () {
    if (isLandscapeMode) {
      showToolbar();
    }
  });

  // --- 语言切换 ---
  function setLang(lang) {
    currentLang = lang;
    document.querySelectorAll('.lang-switch').forEach(function (switchEl) {
      switchEl.querySelectorAll('.lang-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.lang === lang);
      });
    });
  }

  function initLangSwitch(switchEl) {
    switchEl.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        setLang(btn.dataset.lang);
      });
    });
  }

  initLangSwitch(portraitLangSwitch);
  initLangSwitch(landscapeLangSwitch);

  // --- 长按按钮事件绑定 ---
  function bindTalkButton(btn) {
    var touchStarted = false;

    btn.addEventListener('touchstart', function (e) {
      e.preventDefault();
      touchStarted = true;
      startRecording(btn);
    }, { passive: false });

    btn.addEventListener('touchend', function (e) {
      e.preventDefault();
      if (touchStarted) {
        touchStarted = false;
        finishRecording();
      }
    }, { passive: false });

    btn.addEventListener('touchcancel', function (e) {
      e.preventDefault();
      if (touchStarted) {
        touchStarted = false;
        finishRecording();
      }
    }, { passive: false });

    btn.addEventListener('mousedown', function (e) {
      if (touchStarted) return;
      e.preventDefault();
      startRecording(btn);
    });

    btn.addEventListener('mouseup', function (e) {
      if (touchStarted) return;
      e.preventDefault();
      finishRecording();
    });

    btn.addEventListener('mouseleave', function (e) {
      if (touchStarted) return;
      if (isRecording) {
        finishRecording();
      }
    });

    btn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
  }

  bindTalkButton(portraitTalkBtn);
  bindTalkButton(landscapeTalkBtn);

  // --- 工具栏按钮 ---
  exitBtn.addEventListener('click', function () {
    exitLandscapeMode();
  });

  clearBtn.addEventListener('click', function () {
    clearText();
    showToolbar();
  });

  // --- Toast 提示 ---
  function showToast(message) {
    var toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.style.cssText = 'position:fixed;bottom:20%;left:50%;transform:translateX(-50%);' +
        'background:rgba(0,0,0,0.8);color:#fff;padding:12px 24px;border-radius:25px;' +
        'font-size:1rem;z-index:9999;transition:opacity 0.3s;pointer-events:none;' +
        'white-space:nowrap;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { toast.style.opacity = '0'; }, 2500);
  }

  // --- 阻止页面默认手势 ---
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('gesturechange', function (e) { e.preventDefault(); });

})();
