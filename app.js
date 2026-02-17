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
  var pendingFinalize = false;
  var recognition = null;
  var hasText = false;

  // 每次按住的会话累积（按 result index 保存，避免重算导致丢字）
  var sessionSegments = [];

  // 字体大小（vw 单位）
  var FONT_SIZES = [5, 6, 7, 8, 10, 12, 14];
  var fontIndex = 3;

  // --- 兼容性检查 ---
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    unsupportedModal.classList.remove('hidden');
    return;
  }

  // --- 字体大小 ---
  function applyFontSize() {
    textContent.style.fontSize = FONT_SIZES[fontIndex] + 'vw';
  }
  applyFontSize();

  fontUp.addEventListener('click', function () {
    if (fontIndex < FONT_SIZES.length - 1) {
      fontIndex++;
      applyFontSize();
      showToast('字体已放大');
    }
  });

  fontDown.addEventListener('click', function () {
    if (fontIndex > 0) {
      fontIndex--;
      applyFontSize();
      showToast('字体已缩小');
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

  // --- 获取当前会话可显示短句 ---
  function getDisplayParts() {
    var parts = [];
    var hasInterim = false;
    for (var i = 0; i < sessionSegments.length; i++) {
      var seg = sessionSegments[i];
      if (!seg || !seg.text) continue;
      var p = seg.text.trim();
      if (!p) continue;
      if (seg.isFinal) {
        parts.push(p);
      } else {
        parts.push(p);
        hasInterim = true;
      }
    }
    return {
      parts: parts,
      hasInterim: hasInterim
    };
  }

  // 结果处理：不管是否正在录音，只要 session 还没 finalize 就继续接收
  function onResult(event) {
    if (!isRecording && !pendingFinalize) return;

    // 仅更新变化范围，避免全量重建时的状态抖动/丢字
    for (var i = event.resultIndex; i < event.results.length; i++) {
      var r = event.results[i];
      sessionSegments[i] = {
        text: (r[0] && r[0].transcript) ? r[0].transcript : '',
        isFinal: !!r.isFinal
      };
    }

    var display = getDisplayParts();
    if (display.parts.length > 0) {
      updateSessionEl(display.parts, display.hasInterim);
    }
  }

  function onError(event) {
    var msg = '';
    if (event.error === 'not-allowed') {
      msg = '请允许使用麦克风权限';
    } else if (event.error === 'no-speech') {
      msg = '未检测到语音，请重试';
    } else if (event.error === 'network') {
      msg = '无法连接语音服务，请检查网络';
    } else if (event.error === 'service-not-allowed') {
      msg = '语音服务不可用，请换用 Safari(iPhone) 或 Chrome 浏览器';
    } else if (event.error === 'audio-capture') {
      msg = '无法录音，请检查麦克风';
    }
    if (msg) showToast(msg);
  }

  // 识别引擎结束时：做最终 finalize
  function onEnd() {
    if (pendingFinalize) {
      pendingFinalize = false;
      finalizeSession();
      recognition = null;

      if (!hasText) {
        showToast('未检测到语音，请重试');
      }
    } else if (isRecording) {
      // 引擎意外停止（网络中断、超时等）
      isRecording = false;
      finalizeSession();
      recognition = null;
      talkBtn.classList.remove('recording');
      talkBtn.querySelector('.btn-text').textContent = '长按说话';

      if (!hasText) {
        showToast('识别中断，请重试');
      }
    }
  }

  // --- 文字显示 ---
  function clearPlaceholder() {
    var ph = textContent.querySelector('.placeholder-text');
    if (ph) ph.remove();
  }

  // 录音中：已确认短句白色，正在说的那句黄色
  // 使用增量更新，避免每个字符都清空重建导致闪烁
  function updateSessionEl(parts, hasInterim) {
    clearPlaceholder();
    var el = textContent.querySelector('.session-line');
    if (!el) {
      el = document.createElement('div');
      el.className = 'session-line';
      textContent.appendChild(el);
    }

    while (el.children.length < parts.length) {
      var newLine = document.createElement('p');
      newLine.className = 'text-line session-final';
      el.appendChild(newLine);
    }
    while (el.children.length > parts.length) {
      el.removeChild(el.lastChild);
    }

    var finalCount = hasInterim ? parts.length - 1 : parts.length;
    for (var i = 0; i < parts.length; i++) {
      var line = el.children[i];
      line.textContent = parts[i];
      if (i < finalCount) {
        line.className = 'text-line session-final';
      } else {
        line.className = 'text-line session-interim';
      }
    }

    scrollToBottom();
  }

  // 松手后：每个短句变成独立的一行
  function finalizeSession() {
    var display = getDisplayParts();
    var parts = display.parts;
    var el = textContent.querySelector('.session-line');
    if (el) el.remove();

    if (parts.length > 0) {
      clearPlaceholder();
      hasText = true;
      for (var i = 0; i < parts.length; i++) {
        var p = document.createElement('p');
        p.className = 'text-line';
        p.textContent = parts[i];
        textContent.appendChild(p);
      }
      scrollToBottom();
    }

    sessionSegments = [];
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
    pendingFinalize = false;
    sessionSegments = [];

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

  // 松手时：设置 pendingFinalize，调用 stop() 让引擎返回最终结果
  // 真正的 finalize 在 onEnd 中执行，确保不丢失任何识别结果
  function finishRecording() {
    if (!isRecording) return;
    isRecording = false;
    pendingFinalize = true;

    talkBtn.classList.remove('recording');
    talkBtn.querySelector('.btn-text').textContent = '长按说话';

    if (recognition) {
      try { recognition.stop(); } catch (e) {}
    }

    // 安全超时：如果 onEnd 5秒内没触发，强制 finalize
    setTimeout(function () {
      if (pendingFinalize) {
        pendingFinalize = false;
        finalizeSession();
        if (recognition) {
          try { recognition.abort(); } catch (e) {}
          recognition = null;
        }
        if (!hasText) {
          showToast('识别超时，请重试');
        }
      }
    }, 5000);
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
        'background:rgba(0,0,0,0.85);color:#fff;padding:10px 20px;border-radius:20px;' +
        'font-size:0.9rem;z-index:9999;transition:opacity 0.3s;pointer-events:none;' +
        'max-width:85vw;text-align:center;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.style.opacity = '0'; }, 2500);
  }

  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('gesturechange', function (e) { e.preventDefault(); });
})();
