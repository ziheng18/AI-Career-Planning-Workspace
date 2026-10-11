/*!
 * 测试/动效诊断.cjs — 换页动画与"减少动态效果"偏好的交互
 *
 * 为什么单独测：这是本项目里最容易错的动效。
 *   · 换页动画只能用**内联** animation（.wrap 就是 #view，摘类再加类不重播）
 *   · 内联优先级高于样式表，所以 reduced-motion 必须由 JS 拦
 *   · 动画被**中途取消**时触发 animationcancel，不是 animationend——
 *     只监听 animationend 会让内联值永久残留，之后再也不播
 *
 * 用法：node 测试/动效诊断.cjs
 *   会自动起静态服务（自带 node 服务，不依赖 python），跑完关掉。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var PORT = Number(process.env.WB_HTTP_PORT || 8917);
var CDP_PORT = Number(process.env.WB_PORT || 9357);

var BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];
var BROWSER = BROWSERS.filter(function (p) { return fs.existsSync(p); })[0];
if (!BROWSER) { console.log('未找到 Edge/Chrome，跳过动效诊断。'); process.exit(0); }

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

/* 在页面里挂 rAF 采样器，记录 opacity 的最小值与低值帧数 */
var SAMPLER = '(function(){' +
  'var v=document.getElementById("view");' +
  'window.__s=[]; window.__stop=false;' +
  'cancelAnimationFrame(window.__raf);' +
  'window.__tick=function(){' +
  '  var e=document.getElementById("view");' +
  '  if(e) window.__s.push(Number(getComputedStyle(e).opacity));' +
  '  if(!window.__stop) window.__raf=requestAnimationFrame(window.__tick);' +
  '};' +
  'window.__tick(); return true;})()';

async function main() {
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });
  var base = 'http://127.0.0.1:' + PORT + '/';
  var prof = path.join(os.tmpdir(), 'wb-motion-' + Date.now());
  var child = cp.spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + prof,
    '--window-size=1280,900', base + encodeURIComponent('工作台.html')
  ], { stdio: 'ignore' });

  await waitFor(40);
  var page = (await getJson('/json/list')).filter(function (t) { return t.type === 'page'; })[0];
  if (!page) throw new Error('没有可用的页面目标');
  var cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');

  async function ev(expr) {
    var out = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (out.exceptionDetails) {
      throw new Error((out.exceptionDetails.exception || {}).description || out.exceptionDetails.text);
    }
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
  await sleep(600);

  record('应用在 HTTP 下启动', await ev('typeof CP.ui === "object"'));
  record('motionReduced 可调用', await ev('typeof CP.ui.motionReduced') === 'function');

  /* 采样一次换页：返回 <1 的帧数 */
  async function sampleNav(route, settleMs) {
    await ev(SAMPLER);
    await ev('CP.ui.go("' + route + '");');
    await sleep(settleMs || 600);
    await ev('window.__stop=true;');
    var s = await ev('window.__s');
    return { frames: s.length, low: s.filter(function (v) { return v < 0.99; }).length };
  }

  /* ── 基线：正常偏好下换页应播动画 ── */
  await setMotion(false);
  await sleep(1300);                      // 让首屏 fade-up 跑完
  record('reduced-motion 未开启', await ev('CP.ui.motionReduced()') === false);
  var n1 = await sampleNav('result');
  record('正常偏好：换页播动画', n1.low > 0, '低透明度帧 ' + n1.low + '/' + n1.frames);

  /* ── 开启"减少动态效果"后换页不应播 ── */
  await setMotion(true);
  await sleep(300);
  record('reduced-motion 已生效', await ev('CP.ui.motionReduced()') === true);
  var n2 = await sampleNav('action');
  record('减少动态效果：换页不播动画', n2.low === 0, '低透明度帧 ' + n2.low + '/' + n2.frames);

  /* ── 关键回归：关闭偏好后，换页动画必须恢复 ──
     这一条是本次的 bug：动画被偏好打断时只触发 animationcancel，
     只监听 animationend 会让内联值永久残留，之后再也不播。 */
  await setMotion(false);
  await sleep(1300);
  record('关闭后 motionReduced 复位', await ev('CP.ui.motionReduced()') === false);

  var navRoutes = ['result', 'decision', 'ability', 'home', 'export'];
  var recovered = [];
  for (var k = 0; k < navRoutes.length; k++) {
    var r = await sampleNav(navRoutes[k], 500);
    recovered.push({ route: navRoutes[k], low: r.low, frames: r.frames });
  }
  var dead = recovered.filter(function (x) { return x.low === 0; });
  record('关闭偏向后每个页面都能恢复换页动画', dead.length === 0,
    recovered.map(function (x) { return x.route + ':' + x.low + '/' + x.frames; }).join('  '));

  /* ── 关键回归：动画"正在播"时再换页，必须能重新开始 ──
     用真实的快速连续导航制造这个场景（不要靠手动挂内联值——
     现在的实现用 WAAPI，不依赖内联样式，手动造的状态不再代表实际情况）。 */
  await setMotion(false);
  await sleep(1300);

  await ev('CP.ui.go("result");');          // 这次导航会播 220ms 动画
  await sleep(60);                          // 动画播到一半
  var midState = await ev('(function(){var v=document.getElementById("view");' +
    'return JSON.stringify({anims:v.getAnimations().length, opacity:Number(getComputedStyle(v).opacity)});})()');
  var mid = JSON.parse(midState);
  record('（前置）上一次动画确实在播', mid.anims > 0 && mid.opacity < 0.99, midState);

  await ev(SAMPLER);
  await ev('CP.ui.go("action");');           // 动画未播完就再换页
  await sleep(700);
  await ev('window.__stop=true;');
  var during = await ev('window.__s');
  var duringLow = during.filter(function (v) { return v < 0.99; }).length;
  record('动画未播完时换页仍能重新开始', duringLow > 0,
    '低透明度帧 ' + duringLow + '/' + during.length + '（为 0 说明动画没能重启）');

  /* ── 反复开关偏好，动画不能彻底失效 ── */
  for (var t = 0; t < 3; t++) {
    await setMotion(true); await sleep(200);
    await ev('CP.ui.go("decision");'); await sleep(200);
    await setMotion(false); await sleep(300);
  }
  await sleep(900);
  var after = await sampleNav('home', 600);
  record('反复开关偏好后仍能播动画', after.low > 0, '低透明度帧 ' + after.low + '/' + after.frames);

  /* ── 原地重渲染始终不应播 ── */
  await ev('CP.ui.go("decision");');
  await sleep(400);
  await ev(SAMPLER);
  await ev('(function(){var c=document.querySelector("[data-pref]"); if(c) c.click();})()');
  await sleep(500);
  await ev('window.__stop=true;');
  var inPlace = await ev('window.__s');
  var inPlaceLow = inPlace.filter(function (v) { return v < 0.99; }).length;
  record('原地重渲染不播动画', inPlaceLow === 0, '低透明度帧 ' + inPlaceLow + '/' + inPlace.length);

  /* ── 内联值不应永久残留 ── */
  await sleep(600);
  record('渲染后内联 animation 已清空', await ev('document.getElementById("view").style.animation') === '',
    JSON.stringify(await ev('document.getElementById("view").style.animation')));

  cdp.close();
  try { child.kill(); } catch (e) { }
  server.close();
  var fails = results.filter(function (x) { return !x; }).length;
  console.log('\n== ' + (fails === 0 ? '全部通过' : fails + ' 项失败') + ' ==');
  return fails;
}

main().then(function (f) { process.exit(f === 0 ? 0 : 1); }).catch(function (e) {
  console.error('动效诊断失败：' + e.message);
  try { server.close(); } catch (e2) { }
  process.exit(1);
});
