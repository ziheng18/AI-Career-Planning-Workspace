/*!
 * 测试/排序动效诊断.cjs — 决策标准排序：上下移动时两行是否真的在滑动
 *
 * 为什么要单独测：排序移动会走 rerender()，那一步把整个 #view 的 innerHTML
 * 换掉——旧元素被移除、新元素重新插入，元素之间没有可插值的状态，
 * 纯 CSS transition 只会看到"跳变"。所以用 FLIP：量旧位置 → 重渲染 →
 * 量新位置 → WAAPI 从旧位置滑到新位置。
 *
 * 这种实现最容易"写了却不生效"，所以不看代码，直接**逐帧量行位置的 top**：
 * 只有起止两个取值 = 瞬移（没生效）；出现多个中间值 = 真的在滑动。
 *
 * 用法：node 测试/排序动效诊断.cjs
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var cp = require('child_process');

var ROOT = process.cwd();
var PORT = Number(process.env.WB_HTTP_PORT || 8969);
var CDP = Number(process.env.WB_PORT || 9409);

var results = [];
var CP_CRIT_N = 6;   // 决策标准共 6 项（与 CP.CRITERIA 一致）
function record(name, pass, detail) {
  results.push(pass);
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''));
}
var BROWSER = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
  .filter(function (p) { return fs.existsSync(p); })[0];
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
var srv = http.createServer(function (req, res) {
  var rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/工作台.html';
  fs.readFile(path.join(ROOT, rel), function (e, d) {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream' });
    res.end(d);
  });
});
function getJson(p) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: CDP, path: p }, function (res) {
      var b = ''; res.on('data', function (c) { b += c; });
      res.on('end', function () { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function connect(wsUrl) {
  return new Promise(function (resolve, reject) {
    var m = wsUrl.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    var key = Buffer.from(String(Math.random())).toString('base64').slice(0, 22);
    var req = http.request({
      host: m[1], port: Number(m[2]), path: m[3],
      headers: { 'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key }
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
  await new Promise(function (r) { srv.listen(PORT, '127.0.0.1', r); });
  var prof = path.join(os.tmpdir(), 'wb-flip-' + Date.now());
  var child = cp.spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-debugging-port=' + CDP, '--user-data-dir=' + prof,
    '--window-size=1280,1200', 'http://127.0.0.1:' + PORT + '/' + encodeURIComponent('工作台.html')
  ], { stdio: 'ignore' });
  for (var i = 0; i < 40; i++) { try { await getJson('/json/version'); break; } catch (e) { await sleep(300); } }
  var page = (await getJson('/json/list')).filter(function (t) { return t.type === 'page'; })[0];
  var cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  async function ev(expr) {
    var out = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (out.exceptionDetails) throw new Error((out.exceptionDetails.exception || {}).description || out.exceptionDetails.text);
    return out.result ? out.result.value : undefined;
  }
  for (var j = 0; j < 60; j++) {
    if (await ev('typeof CP === "object" && !!CP.ui && !!document.getElementById("view")')) break;
    await sleep(250);
  }
  await ev('CP.ui.archive = CP.demoArchive(); CP.store.save(CP.ui.archive);');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await ev('CP.ui.go("decision");');
  await sleep(800);

  var rowN = await ev('document.querySelectorAll(".sortrow").length');
  var idN = await ev('document.querySelectorAll(".sortrow[data-sortcid]").length');
  record('排序行带 data-sortcid 定位标记', rowN === CP_CRIT_N && idN === rowN,
    rowN + ' 行，其中 ' + idN + ' 行有标记');
  var orderBefore = await ev('(function(){var o=[];document.querySelectorAll(".sortrow[data-sortcid]").forEach(function(e){o.push(e.getAttribute("data-sortcid"));});return o.join(">");})()');

  // 一次 evaluate 里：点"↓"并连采 rAF 帧，记录两行的 top
  var frames = await ev('(function(){' +
    'var rows=[].slice.call(document.querySelectorAll(".sortrow[data-sortcid]"));' +
    'var id0=rows[0].getAttribute("data-sortcid") , id1=rows[1].getAttribute("data-sortcid");' +
    'var out=[];' +
    'function snap(){' +
    '  var a=document.querySelector(\'.sortrow[data-sortcid="\'+id0+\'"]\');' +
    '  var b=document.querySelector(\'.sortrow[data-sortcid="\'+id1+\'"]\');' +
    '  out.push([a?Math.round(a.getBoundingClientRect().top):null, b?Math.round(b.getBoundingClientRect().top):null]);' +
    '}' +
    'snap();' +
    'var btn=document.querySelector(\'.sortrow[data-sortcid="\'+id0+\'"] [data-move="down"]\');' +
    'if(!btn) return Promise.resolve({err:"没找到下移按钮"});' +
    'btn.click();' +
    'snap();' +
    'var hitAtOnce = document.querySelectorAll(".mv-hit").length;' +
    'return new Promise(function(res){var n=0;' +
    '  function step(){ snap(); n++; if(n<22) requestAnimationFrame(step); else res({frames:out, id0:id0, id1:id1, hitAtOnce:hitAtOnce}); }' +
    '  requestAnimationFrame(step);});})()');

  record('点下移按钮能工作', !(frames && frames.err), frames && frames.err ? frames.err : '未报错');

  if (!(frames && frames.err)) {
    var tops = frames.frames.map(function (f) { return f[0]; }).filter(function (x) { return x !== null; });
    var uniq = tops.filter(function (v, i) { return tops.indexOf(v) === i; });
    var last = frames.frames[frames.frames.length - 1];
    record('移动过程中出现中间态（真的在滑动，不是瞬移）', uniq.length > 3,
      '出现 ' + uniq.length + ' 个不同的 top 值；' + frames.id0 + ' ' + tops[0] + '→' + last[0]);
    record('两行确实交换了位置',
      last[0] === frames.frames[0][1] && last[1] === frames.frames[0][0],
      frames.id0 + ' ' + frames.frames[0][0] + '→' + last[0]
      + '；' + frames.id1 + ' ' + frames.frames[0][1] + '→' + last[1]);
    record('按下反馈 .mv-hit 出现在重渲染后的新按钮上', frames.hitAtOnce > 0,
      '点击后立即找到 ' + frames.hitAtOnce + ' 个 .mv-hit');

    var orderAfter = await ev('(function(){var o=[];document.querySelectorAll(".sortrow[data-sortcid]").forEach(function(e){o.push(e.getAttribute("data-sortcid"));});return o.join(">");})()');
    var ob = orderBefore.split('>'), oa = orderAfter.split('>');
    record('排序结果已写入（前两行互换）',
      oa[0] === ob[1] && oa[1] === ob[0] && oa.slice(2).join() === ob.slice(2).join(),
      ob.join('>') + '  →  ' + oa.join('>'));
  }

  cdp.close();
  try { child.kill(); } catch (e) { }
  srv.close();
  var fails = results.filter(function (x) { return !x; }).length;
  console.log('\n== ' + (fails === 0 ? '全部通过' : fails + ' 项失败') + ' ==');
  return fails;
}
main().then(function (f) { process.exit(f === 0 ? 0 : 1); }).catch(function (e) {
  console.error('排序动效诊断失败：' + e.message);
  try { srv.close(); } catch (e2) { }
  process.exit(1);
});
