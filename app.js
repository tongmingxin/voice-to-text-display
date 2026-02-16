/* ============================================
   语音转大字显示 - 核心逻辑
   ============================================ */
(function () {
  'use strict';

  var talkBtn = document.getElementById('talkBtn');
  var textContent = document.getElementById('textContent');
  var textDisplay = document.getElementById('textDisplay');
  var clearBtn = document.getElementById('clearBtn');
  var fontUp = document.getElementById('fontUp');
  var fontDown = document.getElementById('fontDown');
  var unsupportedModal = document.getElementById('unsupportedModal');

  // --- 状态 ---
  var isRecording = false;
  var recognition = null;
  var hasText = false;

  // 每次按住的会话累积
  var sessionFinal = '';
  var sessionInterim = '';

  // 字体大小（vw 单位）
  var FONT_SIZES = [5, 6, 7, 8, 10, 12, 14];
  var fontIndex = 3; // 默认 8vw

  // --- 兼容性检查 ---
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    unsupportedModal.classList.remove('hidden');
    return;
  }

  // --- 应用字体大小 ---
  function applyFontSize() {
    var size = FONT_SIZES[fontIndex];
    textContent.style.fontSize = size + 'vw';
  }
  applyFontSize();

  fontUp.addEventListener('click', function () {
    if (fontIndex < FONT_SIZES.length - 1) {
      fontIndex++;
      applyFontSize();
      showToast('字体: ' + FONT_SIZES[fontIndex] + 'vw');
    }
  });

  fontDown.addEventListener('click', function () {
    if (fontIndex > 0) {
      fontIndex--;
      applyFontSize();
      showToast('字体: ' + FONT_SIZES[fontIndex] + 'vw');
    }
  });

  // --- 语音识别 ---
  function createRecognition() {
    var rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = onResult;
    rec.onerror = onError;
    rec.onend = onEnd;
    return rec;
  }

  function onResult(event) {
    if (!isRecording) return;

    var finals = '';
    var interims = '';
    for (var i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finals += event.results[i][0].transcript;
      } else {
        interims += event.results[i][0].transcript;
      }
    }

    sessionFinal = finals;
    sessionInterim = interims;

    var combined = sessionFinal + sessionInterim;
    if (combined) {
      updateSessionEl(combined, interims.length > 0);
    }
  }

  function onError(event) {
    if (event.error === 'not-allowed') {
      showToast('请允许使用麦克风权限');
    } else if (event.error === 'no-speech') {
      showToast('未检测到语音，请重试');
    } else if (event.error === 'network') {
      showToast('网络错误，请检查网络');
    }
  }

  function onEnd() {
    if (isRecording) {
      finishRecording();
    }
  }

  // --- 文字显示 ---
  function clearPlaceholder() {
    var ph = textContent.querySelector('.placeholder-text');
    if (ph) ph.remove();
  }

  function updateSessionEl(text, isInterim) {
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

  function finalizeSession() {
    var full = (sessionFinal + sessionInterim).trim();
    var el = textContent.querySelector('.session-line');
    if (el) el.remove();

    if (full) {
      clearPlaceholder();
      hasText = true;
      var p = document.createElement('p');
      p.className = 'text-line';
      p.textContent = full;
      textContent.appendChild(p);
      scrollToBottom();
    }

    sessionFinal = '';
    sessionInterim = '';
  }

  function scrollToBottom() {
    requestAnimationFrame(function () {
      textDisplay.scrollTop = textDisplay.scrollHeight;
    });
  }

  // --- 录音控制 ---
  function startRecording() {
    if (isRecording) return;
    isRecording = true;
    sessionFinal = '';
    sessionInterim = '';

    talkBtn.classList.add('recording');
    talkBtn.querySelector('.btn-text').textContent = '松开结束';

    recognition = createRecognition();
    try {
      recognition.start();
    } catch (e) {
      isRecording = false;
      talkBtn.classList.remove('recording');
      talkBtn.querySelector('.btn-text').textContent = '长按说话';
      showToast('启动失败，请重试');
    }
  }

  function finishRecording() {
    if (!isRecording) return;
    isRecording = false;

    // abort() 立即停止，不会再触发 onresult
    if (recognition) {
      try { recognition.abort(); } catch (e) {}
      recognition = null;
    }

    finalizeSession();

    talkBtn.classList.remove('recording');
    talkBtn.querySelector('.btn-text').textContent = '长按说话';

    if (!hasText) {
      showToast('未检测到语音，请重试');
    }
  }

  // --- 按钮事件 ---
  var touchActive = false;

  talkBtn.addEventListener('touchstart', function (e) {
    e.preventDefault();
    touchActive = true;
    startRecording();
  }, { passive: false });

  talkBtn.addEventListener('touchend', function (e) {
    e.preventDefault();
    if (touchActive) { touchActive = false; finishRecording(); }
  }, { passive: false });

  talkBtn.addEventListener('touchcancel', function (e) {
    e.preventDefault();
    if (touchActive) { touchActive = false; finishRecording(); }
  }, { passive: false });

  talkBtn.addEventListener('mousedown', function (e) {
    if (touchActive) return;
    e.preventDefault();
    startRecording();
  });

  talkBtn.addEventListener('mouseup', function (e) {
    if (touchActive) return;
    e.preventDefault();
    finishRecording();
  });

  talkBtn.addEventListener('mouseleave', function () {
    if (touchActive) return;
    if (isRecording) finishRecording();
  });

  talkBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // --- 清空 ---
  clearBtn.addEventListener('click', function () {
    textContent.innerHTML = '<p class="placeholder-text">长按下方按钮说话<br>文字将显示在这里</p>';
    hasText = false;
  });

  // --- Toast ---
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;bottom:18%;left:50%;transform:translateX(-50%);' +
        'background:rgba(0,0,0,0.8);color:#fff;padding:10px 20px;border-radius:20px;' +
        'font-size:0.9rem;z-index:9999;transition:opacity 0.3s;pointer-events:none;' +
        'white-space:nowrap;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.style.opacity = '0'; }, 2000);
  }

  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('gesturechange', function (e) { e.preventDefault(); });
})();
