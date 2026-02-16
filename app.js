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
  let lastInterimText = '';

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
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = handleResult;
    rec.onerror = handleError;
    rec.onend = handleEnd;
    rec.onaudiostart = function () {
      console.log('[语音] 麦克风已开始采集音频');
    };

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
      lastInterimText = '';
    }

    if (interimTranscript) {
      lastInterimText = interimTranscript;
      showInterimText(interimTranscript);
    }
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
    } else {
      showToast('识别出错: ' + event.error);
    }
  }

  function handleEnd() {
    console.log('[语音] 识别结束, isRecording:', isRecording);

    if (isRecording) {
      // 识别引擎意外结束（比如超时），保存中间结果并完成
      finishRecording();
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
    if (!text || !text.trim()) return;

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
    lastInterimText = '';
    talkBtn.classList.add('recording');
    talkBtn.querySelector('.btn-text').textContent = '松开结束';

    if (isLandscapeMode) {
      recordingOverlay.classList.remove('hidden');
      showToolbar();
    }

    recognition = createRecognition();

    try {
      recognition.start();
      console.log('[语音] 开始识别, 语言:', currentLang);
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
    console.log('[语音] 完成录音, lastInterimText:', lastInterimText, 'hasText:', hasText);

    // 如果有未确认的中间结果，将其保存为最终文字
    if (lastInterimText) {
      appendFinalText(lastInterimText);
      lastInterimText = '';
    }

    removeInterimElement();
    resetButtonUI();
    recordingOverlay.classList.add('hidden');

    // 停止识别引擎
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {
        // 可能已经停了
      }
      recognition = null;
    }

    // 切换模式
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
      try {
        var result = requestFS.call(el);
        if (result && result.then) {
          result.then(function () {
            lockLandscape();
          }).catch(function () {
            lockLandscape();
          });
        }
      } catch (e) {
        // 某些浏览器不支持
      }
    }
  }

  function exitFullscreen() {
    var fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsElement) return;

    var exitFS =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;

    if (exitFS) {
      try {
        var result = exitFS.call(document);
        if (result && result.catch) {
          result.catch(function () {});
        }
      } catch (e) {
        // 静默
      }
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
      try {
        screen.orientation.unlock();
      } catch (e) {}
    }
  }

  // 监听全屏状态变化
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  function onFullscreenChange() {
    var isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
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
