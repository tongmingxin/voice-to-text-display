/* ============================================
   讯飞语音听写（流式版）WebAPI 引擎
   用于 Android 设备 Web Speech API 不可用时的备选方案
   ============================================ */
var XfyunASR = (function () {
  'use strict';

  var CFG = {
    appId: '419554e8',
    apiKey: 'ddfc9b1bcb85d8d2c6ca8b7d0f9d60c9',
    apiSecret: 'OTE3ODZjNmMwMWJhZTJmZDMwNWY5Mzg0',
    url: 'wss://iat-api.xfyun.cn/v2/iat'
  };

  var ws = null;
  var mediaStream = null;
  var audioCtx = null;
  var processor = null;
  var sendTimer = null;
  var audioBuf = [];
  var resultMap = {};
  var isFirstFrame = true;
  var active = false;
  var stopping = false;
  var cb = { onResult: null, onError: null, onEnd: null };

  // ---- 工具函数 ----

  function uint8ToBase64(arr) {
    var bin = '';
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function resample(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    var ratio = fromRate / toRate;
    var len = Math.round(input.length / ratio);
    var out = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      var pos = i * ratio;
      var idx = Math.floor(pos);
      var frac = pos - idx;
      var next = Math.min(idx + 1, input.length - 1);
      out[i] = input[idx] * (1 - frac) + input[next] * frac;
    }
    return out;
  }

  function floatToInt16(f32) {
    var i16 = new Int16Array(f32.length);
    for (var i = 0; i < f32.length; i++) {
      var s = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return i16;
  }

  function mergeBuffers() {
    if (audioBuf.length === 0) return null;
    var total = 0;
    for (var i = 0; i < audioBuf.length; i++) total += audioBuf[i].length;
    var merged = new Int16Array(total);
    var off = 0;
    for (var j = 0; j < audioBuf.length; j++) {
      merged.set(audioBuf[j], off);
      off += audioBuf[j].length;
    }
    audioBuf = [];
    return merged;
  }

  // ---- HMAC-SHA256 鉴权 ----

  function getAuthUrl() {
    var host = 'iat-api.xfyun.cn';
    var date = new Date().toUTCString();
    var signOrigin = 'host: ' + host + '\ndate: ' + date + '\nGET /v2/iat HTTP/1.1';

    var enc = new TextEncoder();
    return crypto.subtle.importKey(
      'raw', enc.encode(CFG.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    ).then(function (key) {
      return crypto.subtle.sign('HMAC', key, enc.encode(signOrigin));
    }).then(function (sigBuf) {
      var signature = uint8ToBase64(new Uint8Array(sigBuf));
      var authOrigin = 'api_key="' + CFG.apiKey +
        '", algorithm="hmac-sha256", headers="host date request-line", signature="' + signature + '"';
      var authorization = btoa(authOrigin);
      return CFG.url +
        '?authorization=' + encodeURIComponent(authorization) +
        '&date=' + encodeURIComponent(date) +
        '&host=' + encodeURIComponent(host);
    });
  }

  // ---- 音频采集 ----

  function startCapture() {
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    }).then(function (stream) {
      mediaStream = stream;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      var source = audioCtx.createMediaStreamSource(stream);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = function (e) {
        if (!active) return;
        var raw = e.inputBuffer.getChannelData(0);
        var resampled = resample(raw, audioCtx.sampleRate, 16000);
        audioBuf.push(floatToInt16(resampled));
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);
    });
  }

  function stopCapture() {
    if (processor) { try { processor.disconnect(); } catch (e) {} processor = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(function (t) { t.stop(); }); mediaStream = null; }
  }

  // ---- WebSocket 数据收发 ----

  function sendFrame() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    var pcm = mergeBuffers();
    var b64 = (pcm && pcm.length > 0) ? uint8ToBase64(new Uint8Array(pcm.buffer)) : '';

    if (isFirstFrame) {
      isFirstFrame = false;
      ws.send(JSON.stringify({
        common: { app_id: CFG.appId },
        business: { language: 'zh_cn', domain: 'xfime-mianqie', accent: 'mandarin', ptt: 1 },
        data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: b64 }
      }));
      return;
    }

    if (stopping) {
      if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
      ws.send(JSON.stringify({
        data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: b64 }
      }));
      return;
    }

    if (!b64) return;
    ws.send(JSON.stringify({
      data: { status: 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio: b64 }
    }));
  }

  function parseWords(result) {
    if (!result || !result.ws) return '';
    var text = '';
    for (var i = 0; i < result.ws.length; i++) {
      var cw = result.ws[i].cw;
      if (cw && cw[0]) text += cw[0].w;
    }
    return text;
  }

  function getFullText() {
    var keys = Object.keys(resultMap).map(Number).sort(function (a, b) { return a - b; });
    var text = '';
    for (var i = 0; i < keys.length; i++) text += resultMap[keys[i]];
    return text;
  }

  // ---- 生命周期 ----

  function cleanup() {
    var wasActive = active;
    active = false;
    stopping = false;
    stopCapture();
    if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (wasActive && cb.onEnd) cb.onEnd();
  }

  function start(onResult, onError, onEnd) {
    if (active) return Promise.resolve();
    active = true;
    stopping = false;
    isFirstFrame = true;
    resultMap = {};
    audioBuf = [];
    cb.onResult = onResult;
    cb.onError = onError;
    cb.onEnd = onEnd;

    return startCapture().then(function () {
      return getAuthUrl();
    }).then(function (url) {
      return new Promise(function (resolve, reject) {
        ws = new WebSocket(url);

        ws.onopen = function () {
          sendTimer = setInterval(sendFrame, 40);
          resolve();
        };

        ws.onmessage = function (e) {
          var resp;
          try { resp = JSON.parse(e.data); } catch (err) { return; }
          if (resp.code !== 0) {
            if (cb.onError) cb.onError(resp.message || '识别错误');
            cleanup();
            return;
          }
          if (resp.data && resp.data.result) {
            var sn = resp.data.result.sn;
            var text = parseWords(resp.data.result);
            if (text) resultMap[sn] = text;
            if (cb.onResult) cb.onResult(getFullText(), resp.data.status === 2);
          }
          if (resp.data && resp.data.status === 2) {
            cleanup();
          }
        };

        ws.onerror = function () {
          reject(new Error('讯飞连接失败'));
        };

        ws.onclose = function () {
          if (active) cleanup();
        };
      });
    }).catch(function (err) {
      if (cb.onError) cb.onError('启动失败: ' + (err.message || err));
      cleanup();
    });
  }

  function stop() {
    if (!active) return;
    stopping = true;
    stopCapture();
    sendFrame();
  }

  function isSupported() {
    return !!(
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      (window.AudioContext || window.webkitAudioContext) &&
      window.WebSocket &&
      window.crypto &&
      window.crypto.subtle
    );
  }

  return { start: start, stop: stop, isSupported: isSupported };
})();
