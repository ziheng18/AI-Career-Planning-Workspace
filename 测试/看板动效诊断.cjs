/*!
 * 测试/看板动效诊断.cjs — 行动计划看板：状态流转（待做 → 进行中 → 已完成）的动画
 *
 * 为什么单独测：换列会走整页重渲染（DOM 被替换），纯 CSS transition 只会看到跳变，
 * 所以用 FLIP（量旧位置 → 重渲染 → 量新位置 → 从旧位置滑过去）。
 * 这种实现最容易"写了却不生效"，所以不看代码，直接**逐帧量卡片的 (x, y)**：
 *   只有起止两值 = 瞬移（没生效）；多个中间值 = 真的在滑动。
 * 这里的滑动是**二维**的（跨列时 x 与 y 往往同时变），两个方向都要查。
 *
 * 另外验证落位反馈：三列卡片长得一样，光"滑过去"看不出卡去了哪一列，
 * 所以落位后按目标列的状态色给一次脉冲（进行中=品牌青绿，已完成=成功绿）。
 *
 * 用法：node 测试/看板动效诊断.cjs
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var cp = require('child_process');

var ROOT = process.cwd();
var PORT = Number(process.env.WB_HTTP_PORT || 8981);
var CDP = Number(process.env.WB_PORT || 9423);

var results = [];
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

/* 逐帧记录某张卡的 (left, top) 与落位类 */
var TRACK = [
  '(function(){',
  '  var card = document.querySelector(".kan-col[data-col=\\"todo\\"] .kan-item[data-actid]");',
  '  if (!card) return Promise.resolve({err:"待做列没有卡片"});',
  '  var id = card.getAttribute("data-actid");',
  '  var btn = card.querySelector(\'[data-to="doing"]\');',
  '  if (!btn) return Promise.resolve({err:"没有进行中按钮"});',
  '  var out = [];',
  '  function snap(){',
  '    var e = document.querySelector(\'.kan-item[data-actid="\' + id + \'"]\');',
  '    if (!e) { out.push(null); return; }',
  '    var r = e.getBoundingClientRect();',
  '    var col = e.closest(".kan-col");',
  '    out.push({',
  '      x: Math.round(r.left), y: Math.round(r.top),',
  '      col: col ? col.getAttribute("data-col") : "?",',
  '      cls: e.className,',
  '      op: getComputedStyle(e).opacity,',
  '      shadow: getComputedStyle(e).boxShadow,',
  '      border: getComputedStyle(e).borderTopColor',
  '    });',
  '  }',
  '  snap();',
  '  btn.click();',
  '  snap();',
  '  return new Promise(function(res){',
  '    var n = 0;',
  '    function step(){ snap(); n++; if (n < 26) requestAnimationFrame(step); else res({id:id, frames:out}); }',
  '    requestAnimationFrame(step);',
  '  });',
  '})()'
].join('\n');

/* TRACK2：取待做列**第 4 张**卡移到已完成。
   为什么特意取靠后的那张：跨列时 x 与 y 往往同时变，
   取第 1 张时 y 恰好和已完成列第一张对齐，测不出二维滑动。 */
var TRACK2 = [
  '(function(){',
  '  var cards = [].slice.call(document.querySelectorAll(".kan-col[data-col=\\"todo\\"] .kan-item[data-actid]"));',
  '  if (cards.length < 4) return Promise.resolve({err:"待做列卡片不足：" + cards.length});',
  '  var card = cards[3];',
  '  var id = card.getAttribute("data-actid");',
  '  var before = card.getBoundingClientRect();',
  '  var out = [];',
  '  function snap(){',
  '    var e = document.querySelector(\'.kan-item[data-actid="\' + id + \'"]\');',
  '    if (!e) { out.push(null); return; }',
  '    var r = e.getBoundingClientRect();',
  '    var col = e.closest(".kan-col");',
  '    out.push({x:Math.round(r.left), y:Math.round(r.top), col: col ? col.getAttribute("data-col") : "?"});',
  '  }',
  '  snap();',
  '  card.querySelector(\'[data-to="done"]\').click();',
  '  snap();',
  '  return new Promise(function(res){',
  '    var n = 0;',
  '    function step(){ snap(); n++; if (n < 30) requestAnimationFrame(step); else res({id:id, frames:out}); }',
  '    requestAnimationFrame(step);',
  '  });',
  '})()'
].join('\n');

async function main() {
  await new Promise(function (r) { srv.listen(PORT, '127.0.0.1', r); });
  var prof = path.join(os.tmpdir(), 'wb-kan-' + Date.now());
  var child = cp.spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-debugging-port=' + CDP, '--user-data-dir=' + prof,
    '--window-size=1400,1000', 'http://127.0.0.1:' + PORT + '/' + encodeURIComponent('工作台.html')
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
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await ev('CP.ui.archive = CP.demoArchive(); CP.store.save(CP.ui.archive); CP.ui.go("action");');
  await sleep(900);

  var colN = await ev('document.querySelectorAll(".kan-col[data-col]").length');
  record('三列都带 data-col 定位标记', colN === 3, colN + ' 列');
  var cardN = await ev('document.querySelectorAll(".kan-item[data-actid]").length');
  var totalN = await ev('CP.ui.archive.actions.length');
  record('每张卡片都带 data-actid 定位标记', cardN === totalN,
    cardN + ' 张有标记 / 共 ' + totalN + ' 张');

  /* ① 待做 → 进行中：位置应连续滑动，并出现落位反馈 */
  var r = await ev(TRACK);
  if (r && r.err) {
    record('点「进行中」能工作', false, r.err);
  } else {
    var frames = r.frames.filter(function (f) { return f; });
    var xs = frames.map(function (f) { return f.x; });
    var ys = frames.map(function (f) { return f.y; });
    var ux = xs.filter(function (v, i) { return xs.indexOf(v) === i; }).length;
    var uy = ys.filter(function (v, i) { return ys.indexOf(v) === i; }).length;
    var last = frames[frames.length - 1];

    record('点「进行中」后卡片确实换到进行中列', last.col === 'doing',
      '起始列 todo → 终点列 ' + last.col + '；x ' + xs[0] + '→' + last.x);
    record('跨列移动有中间态（真的在滑动，不是瞬移）', ux > 2 || uy > 2,
      '不同 x ' + ux + ' 个、不同 y ' + uy + ' 个');

    /* ★ 不许"先在终点闪一下再滑过去"。
       重渲染后元素已经在新位置了；如果动画没能在第一次绘制前生效，
       用户就会看到它先在终点出现一两帧。修法是先把元素设成不可见、
       等两帧（此时动画必然已生效）再恢复。
       判定方式：找出**第一个可见帧**，它的位置必须是动画的**起点**，
       不能是终点 —— 否则就是闪过了。 */
    var dest = { x: last.x, y: last.y };
    var firstVisible = frames.filter(function (f) { return Number(f.op) > 0; })[0];
    var flashed = firstVisible && Math.abs(firstVisible.x - dest.x) < 2 && Math.abs(firstVisible.y - dest.y) < 2
      && (Math.abs(firstVisible.x - frames[0].x) > 2 || Math.abs(firstVisible.y - frames[0].y) > 2);
    record('不会先在终点闪现（首个可见帧在起点而非终点）', !flashed,
      firstVisible
        ? ('首个可见帧 x=' + firstVisible.x + ' y=' + firstVisible.y
          + '；起点 x=' + frames[0].x + ' y=' + frames[0].y + '；终点 x=' + dest.x + ' y=' + dest.y)
        : '没有可见帧（可能整段被隐藏）');

    var landed = frames.filter(function (f) { return /kan-land/.test(f.cls); });
    record('落位后播进行中的状态色反馈', landed.length > 0,
      landed.length + ' 帧带 kan-land；边框=' + (landed[0] ? landed[0].border : '—'));
    // 反馈必须是**品牌青绿**这一族，不能是别的颜色（比如误用了成功绿）
    var brandOk = landed.length > 0 && /15,\s*118,\s*110/.test(landed[0].border);
    record('进行中的反馈用的是品牌色', brandOk,
      landed.length ? landed[0].border : '没有反馈帧');
  }

  /* ② 待做第 4 张 → 已完成：x 与 y 往往同时变，两个方向都要有中间态 */
  var r2 = await ev(TRACK2);
  if (r2 && r2.err) {
    record('点「已完成」能工作', false, r2.err);
  } else {
    var f2 = r2.frames.filter(function (f) { return f; });
    var x2 = f2.map(function (f) { return f.x; });
    var y2 = f2.map(function (f) { return f.y; });
    var ux2 = x2.filter(function (v, i) { return x2.indexOf(v) === i; }).length;
    var uy2 = y2.filter(function (v, i) { return y2.indexOf(v) === i; }).length;
    var last2 = f2[f2.length - 1];

    record('二维滑动：x 与 y 方向都有中间态', ux2 > 2 && uy2 > 2,
      'x ' + x2[0] + '→' + last2.x + '（' + ux2 + ' 个值）；y ' + y2[0] + '→' + last2.y + '（' + uy2 + ' 个值）');
    record('点「已完成」后卡片确实换到已完成列', last2.col === 'done',
      '终点列 ' + last2.col);
  }

  /* ③ 避让：目标列原有的卡片必须平滑下移让位。
     构造要点——让被移动的卡在数组里**排在目标列某些卡之前**，
     这样它插入目标列中部，其后的卡必须下移。
     若只是追加到列末，原有卡片根本不动，测不出避让（我第一版就是这样白测的）。 */
  await ev([
    '(function(){',
    '  var a = CP.demoArchive();',
    '  a.actions.forEach(function(x, i){ x.status = i === 0 ? "todo" : (i < 5 ? "doing" : "todo"); });',
    '  CP.ui.archive = a; CP.store.save(a); CP.ui.go("action");',
    '  return true;',
    '})()'
  ].join('\n'));
  await sleep(800);

  var avoid = await ev([
    '(function(){',
    '  var card = document.querySelector(\'.kan-col[data-col="todo"] .kan-item[data-actid]\');',
    '  if (!card) return Promise.resolve({err:"待做列没卡"});',
    '  var staying = [];',
    '  document.querySelectorAll(\'.kan-col[data-col="doing"] .kan-item[data-actid]\').forEach(function(e){',
    '    staying.push({id:e.getAttribute("data-actid"), y0: Math.round(e.getBoundingClientRect().top)});',
    '  });',
    '  if (!staying.length) return Promise.resolve({err:"进行中列原本没有卡片"});',
    '  var frames = [];',
    '  function snap(){',
    '    var row = {};',
    '    staying.forEach(function(o){',
    '      var e = document.querySelector(\'.kan-item[data-actid="\' + o.id + \'"]\');',
    '      row[o.id] = e ? Math.round(e.getBoundingClientRect().top) : null;',
    '    });',
    '    frames.push(row);',
    '  }',
    '  snap();',
    '  card.querySelector(\'[data-to="doing"]\').click();',
    '  snap();',
    '  return new Promise(function(r2){',
    '    var n = 0;',
    '    function step(){ snap(); n++; if (n < 20) requestAnimationFrame(step);',
    '      else r2({staying:staying, frames:frames}); }',
    '    requestAnimationFrame(step);',
    '  });',
    '})()'
  ].join('\n'));

  if (avoid && avoid.err) {
    record('目标列原有卡片会避让', false, avoid.err);
  } else {
    var y0 = avoid.frames[0];
    var lastA = avoid.frames[avoid.frames.length - 1];
    var shifted = avoid.staying.filter(function (o) {
      return lastA[o.id] != null && y0[o.id] != null && Math.abs(lastA[o.id] - y0[o.id]) > 2;
    });
    var smooth = shifted.filter(function (o) {
      var vals = avoid.frames.map(function (f) { return f[o.id]; }).filter(function (v) { return v != null; });
      var uniq = vals.filter(function (v, i) { return vals.indexOf(v) === i; });
      return uniq.length > 2;      // 有中间态才算平滑
    });
    record('目标列原有卡片会下移让位', shifted.length > 0,
      shifted.length + ' / ' + avoid.staying.length + ' 张卡发生位移；'
      + shifted.map(function (o) { return 'y ' + y0[o.id] + '→' + lastA[o.id]; }).join('，'));
    record('让位是平滑移动（有中间态）而非瞬移', smooth.length === shifted.length && shifted.length > 0,
      smooth.length + ' / ' + shifted.length + ' 张有中间态');
    // 让位方向必须是"向下"：新卡插在上面，下面的卡被推下去
    var allDown = shifted.every(function (o) { return lastA[o.id] > y0[o.id]; });
    record('让位方向为向下', allDown,
      shifted.map(function (o) { return (lastA[o.id] - y0[o.id] >= 0 ? '+' : '') + (lastA[o.id] - y0[o.id]); }).join(', '));
  }

  /* ④ 已完成用另一套反馈（成功绿 + 轻微放大），与进行中区分开 */
  var doneCls = await ev([
    '(function(){',
    '  var card = document.querySelector(".kan-col[data-col=\\"todo\\"] .kan-item[data-actid]");',
    '  if (!card) return {err:"待做列没卡了"};',
    '  var id = card.getAttribute("data-actid");',
    '  card.querySelector(\'[data-to="done"]\').click();',
    '  return new Promise(function(res){',
    '    var seen = [];',
    '    var n = 0;',
    '    function step(){',
    '      var e = document.querySelector(\'.kan-item[data-actid="\' + id + \'"]\');',
    '      if (e) seen.push(e.className);',
    '      n++; if (n < 30) requestAnimationFrame(step); else res({id:id, classes:seen});',
    '    }',
    '    requestAnimationFrame(step);',
    '  });',
    '})()'
  ].join('\n'));
  var hasDone = !doneCls.err && doneCls.classes.some(function (c) { return c.indexOf('kan-land-done') >= 0; });
  record('「已完成」用单独的庆祝反馈（kan-land-done）', hasDone,
    doneCls.err || ('出现过的类：' + (doneCls.classes || []).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / ')));

  /* ④ 点当前列的状态按钮不应有任何动画（不做无意义反馈）。
     注意要等上一步的落位动画彻底结束再测：落位反馈持续 0.7s，
     不等它结束就会把**上一次**的类当成这一次的反馈——我第一版就是这样误报的。 */
  await sleep(1000);
  var noop = await ev([
    '(function(){',
    '  var card = document.querySelector(".kan-col[data-col=\\"done\\"] .kan-item[data-actid]");',
    '  if (!card) return {err:"已完成列没卡"};',
    '  var id = card.getAttribute("data-actid");',
    '  var before = card.getBoundingClientRect().left;',
    '  var hadLandBefore = /kan-land/.test(card.className);',
    '  // 确认点之前这张卡是干净的，否则下面的判定无意义',
    '  if (hadLandBefore) return {err:"前置失败：点之前卡片仍带落位类"};',
    '  card.querySelector(\'[data-to="done"]\').click();',
    '  var fresh = document.querySelector(\'.kan-item[data-actid="\' + id + \'"]\');',
    '  return Promise.resolve({err:null,',
    '    sameStatus: CP.ui.archive.actions.filter(function(x){return x.id===id;})[0].status === "done",',
    '    clsRightAfter: fresh ? fresh.className : null,',
    '    sameNode: fresh === card});',
    '})()'
  ].join('\n'));
  record('点当前列的状态按钮不做任何动画（原地不动、不加类）',
    !noop.err && noop.sameStatus && noop.sameNode && !/kan-land/.test(noop.clsRightAfter || ''),
    noop.err || ('状态仍为 done=' + noop.sameStatus + '；DOM 未被替换=' + noop.sameNode
      + '；点击后类=' + noop.clsRightAfter));

  cdp.close();
  try { child.kill(); } catch (e) { }
  srv.close();
  var fails = results.filter(function (x) { return !x; }).length;
  console.log('\n== ' + (fails === 0 ? '全部通过' : fails + ' 项失败') + ' ==');
  return fails;
}
main().then(function (f) { process.exit(f === 0 ? 0 : 1); }).catch(function (e) {
  console.error('看板动效诊断失败：' + e.message);
  try { srv.close(); } catch (e2) { }
  process.exit(1);
});
