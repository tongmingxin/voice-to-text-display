/* ============================================
   语音转大字显示 - 核心逻辑
   双引擎：Web Speech API（默认）+ 讯飞（兜底）
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
  var useXfyun = false;
  var wsEverWorked = false; // Web Speech API 是否曾经成功识别过

  // Web Speech API 会话数据
  var sessionSegments = [];

  // 讯飞会话数据
  var xfText = '';

  // 字体大小（vw 单位）
  var FONT_SIZES = [5, 6, 7, 8, 10, 12, 14];
  var fontIndex = 3;

  // --- 兼容性检查 ---
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var hasXfyun = (typeof XfyunASR !== 'undefined') && XfyunASR.isSupported();

  if (!SR && !hasXfyun) {
    unsupportedModal.classList.remove('hidden');
    return;
  }
  if (!SR && hasXfyun) {
    useXfyun = true;
  }

  // --- 字体大小 ---
  function applyFontSize() {
    textContent.style.fontSize = FONT_SIZES[fontIndex] + 'vw';
  }
  applyFontSize();

  fontUp.addEventListener('click', function () {
    if (fontIndex < FONT_SIZES.length - 1) { fontIndex++; applyFontSize(); showToast('字体已放大'); }
  });
  fontDown.addEventListener('click', function () {
    if (fontIndex > 0) { fontIndex--; applyFontSize(); showToast('字体已缩小'); }
  });

  // =======================================================
  //  通用显示逻辑
  // =======================================================

  function clearPlaceholder() {
    var ph = textContent.querySelector('.placeholder-text');
    if (ph) ph.remove();
  }

  function scrollToBottom() {
    requestAnimationFrame(function () { textDisplay.scrollTop = textDisplay.scrollHeight; });
  }

  // 录音中显示（黄色斜体）
  function showSessionText(text) {
    clearPlaceholder();
    var el = textContent.querySelector('.session-line');
    if (!el) {
      el = document.createElement('div');
      el.className = 'session-line';
      textContent.appendChild(el);
    }
    // 单个 <p> 显示全文
    if (el.children.length === 0) {
      var p = document.createElement('p');
      p.className = 'text-line session-interim';
      el.appendChild(p);
    }
    el.children[0].textContent = text;
    scrollToBottom();
  }

  // 松手后落盘（黄色非斜体 = latest-session）
  function commitSession(text) {
    var el = textContent.querySelector('.session-line');
    if (el) el.remove();

    // 移除上一轮的标记
    var old = textContent.querySelectorAll('.latest-session');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('latest-session');

    var trimmed = text.trim();
    if (trimmed) {
      clearPlaceholder();
      hasText = true;
      var p = document.createElement('p');
      p.className = 'text-line latest-session';
      p.textContent = trimmed;
      textContent.appendChild(p);
      scrollToBottom();
    }
  }

  function resetUI() {
    isRecording = false;
    pendingFinalize = false;
    talkBtn.classList.remove('recording');
    talkBtn.querySelector('.btn-text').textContent = '长按说话';
  }

  // =======================================================
  //  Web Speech API 引擎
  // =======================================================

  function createRecognition() {
    var rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = wsOnResult;
    rec.onerror = wsOnError;
    rec.onend = wsOnEnd;
    return rec;
  }

  function getWSText() {
    var finals = [];
    var interim = '';
    for (var i = 0; i < sessionSegments.length; i++) {
      var seg = sessionSegments[i];
      if (!seg || !seg.text) continue;
      if (seg.isFinal) {
        if (finals.length === 0 || finals[finals.length - 1] !== seg.text.trim()) {
          finals.push(seg.text.trim());
        }
      } else {
        interim += seg.text;
      }
    }
    // 去除 interim 与 finals 重叠前缀
    var it = interim.trim();
    if (it && finals.length > 0) {
      var all = finals.join('');
      if (all && it.indexOf(all) === 0) it = it.slice(all.length);
      else {
        var last = finals[finals.length - 1];
        if (last && it.indexOf(last) === 0) it = it.slice(last.length);
      }
    }
    var combined = finals.join('') + it;
    return combined;
  }

  function wsOnResult(event) {
    if (!isRecording && !pendingFinalize) return;
    wsEverWorked = true;
    for (var i = event.resultIndex; i < event.results.length; i++) {
      var r = event.results[i];
      sessionSegments[i] = {
        text: (r[0] && r[0].transcript) ? r[0].transcript : '',
        isFinal: !!r.isFinal
      };
    }
    sessionSegments.length = event.results.length;
    var text = getWSText();
    if (text) showSessionText(text);
  }

  // Web Speech API 从未成功过 → 切换讯飞
  function trySwitchToXfyun() {
    if (useXfyun || wsEverWorked || !hasXfyun) return false;
    useXfyun = true;
    if (recognition) { try { recognition.abort(); } catch (e) {} recognition = null; }
    pendingFinalize = false;
    var el = textContent.querySelector('.session-line');
    if (el) el.remove();
    resetUI();
    showToast('已切换识别引擎，请再次长按说话');
    return true;
  }

  function wsOnError(event) {
    // 权限被拒绝 → 不切换，直接提示（讯飞也需要麦克风权限）
    if (event.error === 'not-allowed') {
      showToast('请允许使用麦克风权限');
      return;
    }
    // 其他所有错误：如果 Web Speech API 从未成功过，切换讯飞
    if (trySwitchToXfyun()) return;

    var msg = '';
    if (event.error === 'no-speech') msg = '未检测到语音，请重试';
    else if (event.error === 'network') msg = '无法连接语音服务';
    else if (event.error === 'audio-capture') msg = '无法录音，请检查麦克风';
    else msg = '识别出错，请重试';
    showToast(msg);
  }

  function wsOnEnd() {
    if (pendingFinalize) {
      pendingFinalize = false;
      var text = getWSText();
      if (!text && trySwitchToXfyun()) return;
      commitSession(text);
      recognition = null;
      if (!hasText) showToast('未检测到语音，请重试');
    } else if (isRecording) {
      var text2 = getWSText();
      if (!text2 && trySwitchToXfyun()) return;
      commitSession(text2);
      recognition = null;
      resetUI();
      if (!hasText) showToast('识别中断，请重试');
    }
  }

  function startWS() {
    sessionSegments = [];
    recognition = createRecognition();
    try {
      recognition.start();
    } catch (e) {
      if (hasXfyun) {
        useXfyun = true;
        startXF();
        showToast('已切换识别引擎');
      } else {
        resetUI();
        showToast('启动失败，请重试');
      }
    }
  }

  function stopWS() {
    pendingFinalize = true;
    if (recognition) { try { recognition.stop(); } catch (e) {} }
    setTimeout(function () {
      if (pendingFinalize) {
        pendingFinalize = false;
        commitSession(getWSText());
        if (recognition) { try { recognition.abort(); } catch (e) {} recognition = null; }
        if (!hasText) showToast('识别超时，请重试');
      }
    }, 5000);
  }

  // =======================================================
  //  讯飞引擎
  // =======================================================

  function startXF() {
    xfText = '';
    XfyunASR.start(
      function onResult(text) {
        xfText = text;
        if (text) showSessionText(text);
      },
      function onError(msg) {
        showToast(msg || '识别出错');
      },
      function onEnd() {
        if (pendingFinalize || isRecording) {
          commitSession(xfText);
          resetUI();
          if (!hasText) showToast('未检测到语音，请重试');
        }
      }
    );
  }

  function stopXF() {
    pendingFinalize = true;
    XfyunASR.stop();
    setTimeout(function () {
      if (pendingFinalize) {
        commitSession(xfText);
        resetUI();
        if (!hasText) showToast('识别超时，请重试');
      }
    }, 8000);
  }

  // =======================================================
  //  录音控制（统一入口）
  // =======================================================

  function startRecording() {
    if (isRecording) return;
    isRecording = true;
    pendingFinalize = false;

    talkBtn.classList.add('recording');
    talkBtn.querySelector('.btn-text').textContent = '松开结束';

    if (useXfyun) {
      startXF();
    } else {
      startWS();
    }
  }

  function finishRecording() {
    if (!isRecording) return;
    isRecording = false;

    talkBtn.classList.remove('recording');
    talkBtn.querySelector('.btn-text').textContent = '长按说话';

    if (useXfyun) {
      stopXF();
    } else {
      stopWS();
    }
  }

  // =======================================================
  //  按钮事件
  // =======================================================

  var touchActive = false;

  talkBtn.addEventListener('touchstart', function (e) {
    e.preventDefault(); touchActive = true; startRecording();
  }, { passive: false });

  talkBtn.addEventListener('touchend', function (e) {
    e.preventDefault(); if (touchActive) { touchActive = false; finishRecording(); }
  }, { passive: false });

  talkBtn.addEventListener('touchcancel', function (e) {
    e.preventDefault(); if (touchActive) { touchActive = false; finishRecording(); }
  }, { passive: false });

  talkBtn.addEventListener('mousedown', function (e) {
    if (touchActive) return; e.preventDefault(); startRecording();
  });

  talkBtn.addEventListener('mouseup', function (e) {
    if (touchActive) return; e.preventDefault(); finishRecording();
  });

  talkBtn.addEventListener('mouseleave', function () {
    if (touchActive) return; if (isRecording) finishRecording();
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
