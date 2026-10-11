/*!
 * 测试/图表动效诊断.cjs — 验证图表入场动画真的播了、且不影响可读性
 *
 * 为什么需要它：SVG 的入场动画很容易"看起来写了却不生效"
 *   （SVG 几何属性不能做 CSS transition；transform-origin 在 SVG 里按视口算）。
 *   所以这里不看代码，直接读元素的实际 transform / opacity。
 *
 * 检查项：
 *   · 换页后条形图从 0 宽度长出（采样 transform 的 scaleX）
 *   · 动画结束后元素回到终态（scaleX = 1，无残留 transform）
 *   · 决策页原地重渲染**不重播**图表动画（否则每点一个选项图就重长一次）
 *   · prefers-reduced-motion 下不播
 *   · 打印视图里图形是完整终态（属性值即终态，与动画无关）
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var PORT = Number(process.env.WB_HTTP_PORT || 8947);
var CDP_PORT = Number(process.env.WB_PORT || 9387);

var BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(function (p) { return fs.existsSync(p); })[0];
if (!BROWSER) { console.log('未找到 Edge/Chrome，跳过图表动效诊断。'); process.exit(0); }

var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png'
};
var server = http.createServer(function (req, res) {
  var rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/工作台.html';
  var abs = path.join(ROOT, rel);
  if (abs.indexOf(ROOT) !== 0) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(abs, function (e, d) {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(d);
  });
});

var results = [];
function record(name, pass, detail) {
  results.push(pass);
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''));
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function getJson(p) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: CDP_PORT, path: p }, function (res) {
      var b = ''; res.on('data', function (c) { b += c; });
      res.on('end', function () { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function waitFor(tries) {
  return getJson('/json/version').catch(function (e) {
    if (tries <= 0) throw e;
    return sleep(300).then(function () { return waitFor(tries - 1); });
  });
}
function connect(wsUrl) {
  return new Promise(function (resolve, reject) {
    var m = wsUrl.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    var key = Buffer.from(String(Math.random())).toString('base64').slice(0, 22);
    var req = http.request({
      host: m[1], port: Number(m[2]), path: m[3],
      headers: {
        'Connection': 'Upgrade', 'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key
      }
    });
    req.on('upgrade', function (res, socket) {
      var id = 0, pending = {}, buf = Buffer.alloc(0);
      function send(method, params) {
        return new Promise(function (r2) {
          var myId = ++id; pending[myId] = r2;
          var payload = Buffer.from(JSON.stringify({ id: myId, method: method, params: params || {} }));
          var mask = Buffer.from([0, 0, 0, 0]), len = payload.length, header;
          if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
          else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
          else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
          socket.write(Buffer.concat([header, mask, payload]));
        });
      }
      socket.on('data', function (chunk) {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          var op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
          var len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (masked) off += 4;
          if (buf.length < off + len) return;
          var p2 = buf.slice(off, off + len); buf = buf.slice(off + len);
          if (op === 8) { socket.end(); continue; }
          if (op !== 1) continue;
          var msg; try { msg = JSON.parse(p2.toString('utf8')); } catch (e) { continue; }
          if (msg.id && pending[msg.id]) { pending[msg.id](msg.result || msg.error); delete pending[msg.id]; }
        }
      });
      socket.on('error', reject);
      resolve({ send: send, close: function () { socket.end(); } });
    });
    req.on('error', reject); req.end();
  });
}

async function main() {
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });
  var prof = path.join(os.tmpdir(), 'wb-chart-' + Date.now());
  var child = cp.spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + prof,
    '--window-size=1280,1000', 'http://127.0.0.1:' + PORT + '/' + encodeURIComponent('工作台.html')
  ], { stdio: 'ignore' });
  await waitFor(40);
  var page = (await getJson('/json/list')).filter(function (t) { return t.type === 'page'; })[0];
  if (!page) throw new Error('没有可用的页面目标');
  var cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  async function ev(expr) {
    var out = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (out.exceptionDetails) throw new Error((out.exceptionDetails.exception || {}).description || out.exceptionDetails.text);
    return out.result ? out.result.value : undefined;
  }
  async function setMotion(reduce) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }]
    });
  }

  for (var i = 0; i < 40; i++) {
    if (await ev('typeof CP === "object" && !!CP.ui && !!document.getElementById("view")')) break;
    await sleep(250);
  }
  await ev('CP.ui.archive = CP.demoArchive(); CP.store.save(CP.ui.archive);');
  await setMotion(false);
  await sleep(900);

  record('Element.animate 可用', await ev('typeof document.getElementById("view").animate === "function"'));

  /* ── 采样器：记录所有 [data-anim="grow"] 的 scaleX ── */
  var SAMPLER = '(function(){' +
    'window.__g=[]; window.__stop=false;' +
    'window.__t=function(){' +
    '  var els=document.querySelectorAll(\'[data-anim="grow"]\');' +
    '  var arr=[];' +
    '  Array.prototype.forEach.call(els,function(e){' +
    '    var t=getComputedStyle(e).transform;' +
    '    var sx=1;' +
    '    var m=/matrix\\(([-\\d.]+)/.exec(t);' +
    '    if(m) sx=Number(m[1]);' +
    '    arr.push(sx);' +
    '  });' +
    '  window.__g.push(arr);' +
    '  if(!window.__stop) requestAnimationFrame(window.__t);' +
    '};' +
    'window.__t(); return true;})()';

  /* ── 换页到结果页，看条形图是否从 0 长出 ── */
  await ev('CP.ui.go("home");');
  await sleep(500);
  await ev(SAMPLER);
  await ev('CP.ui.go("result");');
  await sleep(1000);
  await ev('window.__stop=true;');
  var frames = await ev('window.__g');
  var growCount = await ev('document.querySelectorAll(\'[data-anim="grow"]\').length');

  var sawSmall = false;
  var minSeen = 1;
  frames.forEach(function (f) {
    f.forEach(function (sx) { if (sx < minSeen) minSeen = sx; });
  });
  sawSmall = minSeen < 0.5;
  record('换页后条形从 0 宽度长出', sawSmall,
    '最小 scaleX = ' + minSeen.toFixed(3) + '（采样 ' + frames.length + ' 帧，' + growCount + ' 条）');
  record('图表元素确实存在', growCount > 0, growCount + ' 个 grow 元素');

  /* ── 动画结束后应回到终态 ── */
  await sleep(800);
  var finalTf = await ev('(function(){' +
    'var e=document.querySelector(\'[data-anim="grow"]\');' +
    'return e ? getComputedStyle(e).transform : "无元素";})()');
  record('动画结束后回到终态（无残留缩放）',
    finalTf === 'none' || /matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)/.test(finalTf),
    'transform=' + finalTf);

  /* ── 原地重渲染不应重播（keepScroll 为真时） ──
     注意：必须选**真有图表**的页面来测。
     决策页没有图表（grow 元素为 0），在那里断言等于没测到——
     我第一版就踩了这个坑，断言"通过"但毫无意义。 */
  await ev('CP.ui.go("result");');
  await sleep(900);
  var before = await ev('document.querySelectorAll(\'[data-anim="grow"]\').length');
  record('（前置）结果页确有图表元素', before > 0, before + ' 个 grow 元素');

  await ev(SAMPLER);
  // 原地重渲染：keepScroll 为真（决策页改选项走的就是这条路）
  await ev('CP.ui.render({ keepScroll: true });');
  await sleep(700);
  await ev('window.__stop=true;');
  var inPlace = await ev('window.__g');
  var minInPlace = 1;
  inPlace.forEach(function (f) { f.forEach(function (sx) { if (sx < minInPlace) minInPlace = sx; }); });
  record('原地重渲染不重播图表动画', minInPlace >= 0.5,
    '最小 scaleX = ' + minInPlace.toFixed(3) + '（采样 ' + inPlace.length + ' 帧）');

  /* ── 对照组：真正换页时必须重播（证明上一条不是"动画根本没播"的假通过） ── */
  await ev('CP.ui.go("home");');
  await sleep(600);
  var homeHasCharts = await ev('document.querySelectorAll(\'[data-anim="grow"]\').length');
  await ev(SAMPLER);
  await ev('CP.ui.go("result");');
  await sleep(1000);
  await ev('window.__stop=true;');
  var replay = await ev('window.__g');
  var minReplay = 1;
  var nonEmpty = 0;
  replay.forEach(function (f) {
    if (f.length) nonEmpty += 1;
    f.forEach(function (sx) { if (sx < minReplay) minReplay = sx; });
  });
  record('对照组：真换页时会重播（上一条不是假通过）', minReplay < 0.5,
    '最小 scaleX = ' + minReplay.toFixed(3)
    + '；采样 ' + replay.length + ' 帧（其中 ' + nonEmpty + ' 帧有元素）'
    + '；换页前首页图表数 = ' + homeHasCharts);

  /* ── 方向断言：条形必须从锚点长出，而不是两头一起动 ──
     为什么单独测方向：只断言"scaleX 会变小"是**弱断言**——
     方向反了（两头一起缩放、看起来像从右侧淡入）也照样通过。
     用户报过这个现象，所以这里直接量矩形边缘。 */
  async function burstDirection(label) {
    var frames = await ev('(function(){' +
      'var els=[].slice.call(document.querySelectorAll(\'[data-anim="grow"]\'));' +
      'var out=[];' +
      'function snap(){' +
      '  var row=[];' +
      '  els.forEach(function(e){' +
      '    var m=/matrix\\(([-\\d.]+),\\s*([-\\d.]+)/.exec(getComputedStyle(e).transform);' +
      '    var sx=m?Number(m[1]):1;' +
      '    var r=e.getBoundingClientRect();' +
      '    row.push([sx, Math.round(r.left), Math.round(r.right)]);' +
      '  });' +
      '  out.push(row);' +
      '}' +
      'snap();' +
      'return new Promise(function(res){' +
      '  var n=0;' +
      '  function step(){ snap(); n++; if(n<40) requestAnimationFrame(step); else res({frames:out, els:els.length}); }' +
      '  requestAnimationFrame(step);' +
      '});})()');
    // 取宽度最小的一帧作为起点（不是第一帧——可能动画还没开始）
    var best = null, bestW = Infinity;
    frames.frames.forEach(function (f) {
      var w = f.reduce(function (a, x) { return a + (x[2] - x[1]); }, 0);
      if (f.length && w < bestW) { bestW = w; best = f; }
    });
    var last = frames.frames[frames.frames.length - 1];
    return { start: best, end: last, n: frames.els, label: label };
  }

  // 条形图：left 必须固定，right 必须增长
  await ev('CP.ui.go("result");');
  await sleep(500);
  await ev('(function(){var b=document.querySelector(\'.result-tabs [data-tab="profile"]\'); if(b) b.click();})()');
  await sleep(1200);
  await ev('CP.ui.animateCharts(document.getElementById("view"));');
  var bars = await burstDirection('bars');
  var barsOk = true, barsDetail = [];
  bars.start.forEach(function (s, i) {
    var e = bars.end[i];
    if (Math.abs(e[1] - s[1]) > 2) barsOk = false;      // left 不该动
    if (e[2] - s[2] < 10) barsOk = false;               // right 必须显著增大
    if (i < 3) barsDetail.push('条' + i + ' left ' + s[1] + '→' + e[1] + ' right ' + s[2] + '→' + e[2]);
  });
  record('条形从锚点向右长出（左边缘不动）', barsOk, barsDetail.join('；'));

  // 缺口图左半：right 固定在中线，left 向左减小
  await ev('(function(){var b=document.querySelector(\'.result-tabs [data-tab="gap"]\'); if(b) b.click();})()');
  await sleep(1200);
  await ev('CP.ui.animateCharts(document.getElementById("view"));');
  var gaps = await burstDirection('gaps');
  var gapOk = true, gapDetail = [];
  // 缺口图里同性排布是"左条、右条、左条、右条…"，偶数索引是左半条
  gaps.start.forEach(function (s, i) {
    if (i > 5) return;
    var e = gaps.end[i];
    var isLeft = (i % 2 === 0);
    if (isLeft) {
      if (Math.abs(e[2] - s[2]) > 2) gapOk = false;     // right 固定
      if (s[1] - e[1] < 10) gapOk = false;              // left 必须减小
    }
    if (i < 3) gapDetail.push('条' + i + (isLeft ? '(左半)' : '(右半)') + ' left ' + s[1] + '→' + e[1] + ' right ' + s[2] + '→' + e[2]);
  });
  record('缺口图左半条从中线向左长出（右边缘不动）', gapOk, gapDetail.join('；'));

  /* ── reduced-motion 下不播 ── */
  await setMotion(true);
  await sleep(300);
  await ev('CP.ui.go("home");');
  await sleep(400);
  await ev(SAMPLER);
  await ev('CP.ui.go("result");');
  await sleep(900);
  await ev('window.__stop=true;');
  var reduced = await ev('window.__g');
  var minReduced = 1;
  reduced.forEach(function (f) { f.forEach(function (sx) { if (sx < minReduced) minReduced = sx; }); });
  record('减少动态效果时图表不播动画', minReduced >= 0.5,
    '最小 scaleX = ' + minReduced.toFixed(3));
  await setMotion(false);

  /* ── 图形属性存终态：与动画无关，打印视图一定完整 ── */
  var attrOk = await ev('(function(){' +
    'var e=document.querySelector(\'[data-anim="grow"]\');' +
    'if(!e) return "无元素";' +
    'var w=Number(e.getAttribute("width"));' +
    'return JSON.stringify({width:w, positive: w>0});})()');
  var a = JSON.parse(attrOk);
  record('图形属性存的是终态宽度（打印视图因此完整）', a.positive, attrOk);

  cdp.close();
  try { child.kill(); } catch (e) { }
  server.close();
  var fails = results.filter(function (x) { return !x; }).length;
  console.log('\n== ' + (fails === 0 ? '全部通过' : fails + ' 项失败') + ' ==');
  return fails;
}

main().then(function (f) { process.exit(f === 0 ? 0 : 1); }).catch(function (e) {
  console.error('图表动效诊断失败：' + e.message);
  try { server.close(); } catch (e2) { }
  process.exit(1);
});
