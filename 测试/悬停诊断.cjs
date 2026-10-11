/*!
 * 测试/悬停诊断.cjs — 鼠标悬停在**已选中**控件上时，文字是否仍然可读
 *
 * 为什么单独一层：:hover 是纯 CSS 行为，假 DOM 测不到（没有伪类状态），
 * 浏览器诊断也不测悬停。而"hover 规则盖住选中态"是本项目反复出现的错误：
 *   `.scale button:hover { color: var(--brand) }` 会把**已选中**档位的白字
 *   改成品牌色，青绿字落在青绿底上——对比度 1.00，数字完全消失（用户报过）。
 *
 * 做法：用 CDP 派发真实 mouseMoved 触发 :hover，再按祖先链合成实际可见底色
 * 算对比度。**浅色与深色都跑**——修复本身就分了两套主题，只测一种会漏。
 *
 * 用法：node 测试/悬停诊断.cjs
 *   $env:WB_DARK="0"; node 测试/悬停诊断.cjs   # 只跑浅色
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var cp = require('child_process');

/* ── 不带 WB_DARK 时，自己串行跑浅色 + 深色两遍 ──
   为什么要在脚本里跑两遍：.scale button.on:hover 分了两套主题的规则
   （浅色加深、深色提亮），只跑当前系统那一种会漏掉另一半。 */
if (process.env.WB_DARK === undefined) {
  var self = __filename;
  var mk = function (dark) {
    var e = Object.assign({}, process.env);
    e.WB_DARK = dark ? '1' : '0';
    return e;
  };
  console.log('=== 第一遍：浅色 ===');
  var r1 = cp.spawnSync(process.execPath, [self], { stdio: 'inherit', env: mk(false) });
  console.log('');
  console.log('=== 第二遍：深色 ===');
  var r2 = cp.spawnSync(process.execPath, [self], { stdio: 'inherit', env: mk(true) });
  var bad = (r1.status !== 0 ? 1 : 0) + (r2.status !== 0 ? 1 : 0);
  console.log('');
  console.log('== ' + (bad === 0 ? '两种配色全部通过' : bad + ' 种配色有失败') + ' ==');
  process.exit(bad === 0 ? 0 : 1);
}

var ROOT = process.cwd();
var PORT = 8967;
var CDP = 9407;
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
var results = [];
function record(name, pass, detail) {
  results.push(pass);
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''));
}

async function main() {
  await new Promise(function (r) { srv.listen(PORT, '127.0.0.1', r); });
  var prof = path.join(os.tmpdir(), 'wb-hover-' + Date.now());
  var child = cp.spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-debugging-port=' + CDP, '--user-data-dir=' + prof,
    '--window-size=1280,1000', 'http://127.0.0.1:' + PORT + '/' + encodeURIComponent('工作台.html')
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
  // 用环境变量控制配色，浅色/深色都要过——修复本身就分了两套
  var wantDark = process.env.WB_DARK !== '0';
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: wantDark ? 'dark' : 'light' }]
  });
  console.log('=== 配色: ' + (wantDark ? '深色' : '浅色') + ' ===');

  /* 对比度工具（注入页面） */
  await ev('(function(){' +
    'window.__pc=function(c){var m=/rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*(?:,\\s*([\\d.]+)\\s*)?\\)/.exec(c||"");' +
    'return m?{r:+m[1],g:+m[2],b:+m[3],a:m[4]===undefined?1:+m[4]}:null;};' +
    'window.__ch=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};' +
    'window.__lum=function(c){return 0.2126*window.__ch(c.r)+0.7152*window.__ch(c.g)+0.0722*window.__ch(c.b);};' +
    'window.__eff=function(el){var a=[],n=el;while(n&&n.nodeType===1){var c=window.__pc(getComputedStyle(n).backgroundColor);' +
    'if(c&&c.a>0){a.push(c);if(c.a>=0.999)break;}n=n.parentElement;}' +
    'if(!a.length)return{r:255,g:255,b:255};var o={r:255,g:255,b:255};' +
    'for(var i=a.length-1;i>=0;i--){var c=a[i];o={r:c.r*c.a+o.r*(1-c.a),g:c.g*c.a+o.g*(1-c.a),b:c.b*c.a+o.b*(1-c.a)};}return o;};' +
    'window.__ratio=function(el){var f=window.__pc(getComputedStyle(el).color),e=window.__eff(el);' +
    'if(!f)return -1;var l1=Math.max(window.__lum(e),window.__lum(f)),l2=Math.min(window.__lum(e),window.__lum(f));' +
    'return (l1+0.05)/(l2+0.05);};' +
    'return true;})()');

  async function hoverAndCheck(sel, label, clickFirst) {
    // 先点到"已选中"状态
    if (clickFirst) {
      await ev('(function(){var e=document.querySelector("' + sel + '"); if(e) e.click();})()');
      await sleep(300);
    }
    var box = await ev('(function(){var e=document.querySelector("' + sel + '");' +
      'if(!e) return null;var r=e.getBoundingClientRect();' +
      'return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),cls:e.className});})()');
    if (!box) { record(label, false, '元素不存在：' + sel); return; }
    var b = JSON.parse(box);
    // 移到别处再移回来，确保 :hover 重新计算
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await sleep(80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
    await sleep(250);
    var r = await ev('(function(){var e=document.querySelector("' + sel + '");' +
      'var cs=getComputedStyle(e);' +
      'return JSON.stringify({hovered:e.matches(":hover"), color:cs.color, bg:cs.backgroundColor, ratio:Number(window.__ratio(e).toFixed(2))});})()');
    var o = JSON.parse(r);
    // 必须真的进入 hover 才有意义——否则测的是静态样式
    record(label,
      o.hovered === true && o.ratio >= 3,
      '悬浮=' + o.hovered + ' 对比度=' + o.ratio + ' 文字=' + o.color + ' 底色=' + o.bg + ' 类=' + b.cls);
  }

  console.log('=== 兴趣测评：量表按钮 ===');
  await ev('CP.ui.go("riasec");');
  await sleep(500);
  await hoverAndCheck('.scale button', '未选中的档位（hover）');
  await hoverAndCheck('.qitem:nth-child(1) .scale button:nth-child(4)', '已选中的档位（hover）', true);

  console.log('');
  console.log('=== 决策输入：胶囊 ===');
  await ev('CP.ui.go("decision");');
  await sleep(500);
  await hoverAndCheck('.chip', '未选中的胶囊（hover）');
  await hoverAndCheck('.chip', '已选中的胶囊（hover）', true);

  console.log('');
  console.log('=== 导航：当前页项 ===');
  await hoverAndCheck('.nav-item.active', '当前页导航项（hover）');

  cdp.close();
  try { child.kill(); } catch (e) { }
  srv.close();
  var fails = results.filter(function (x) { return !x; }).length;
  console.log('\n== ' + (fails === 0 ? '全部通过' : fails + ' 项失败') + ' ==');
  return fails;
}
main().then(function (f) { process.exit(f === 0 ? 0 : 1); }).catch(function (e) {
  console.error('悬停诊断失败：' + e.message);
  try { srv.close(); } catch (e2) { }
  process.exit(1);
});
