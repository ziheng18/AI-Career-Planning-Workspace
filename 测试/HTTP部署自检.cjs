/*!
 * 测试/HTTP部署自检.cjs — 验证应用在 HTTP 服务下（而非 file://）行为正常
 *
 * 为什么要专门测：GitHub Pages 是 HTTP，而 file:// 与 HTTP 在两处不同——
 *   ① fetch 相对路径（封面图转 base64 打印用）在 file:// 下受限，HTTP 下走网络
 *   ② window.open 在 HTTP 下受弹窗拦截策略约束
 * 这两条只看代码看不出来，必须实测。
 *
 * 用法：node 测试/HTTP部署自检.cjs
 *   会自动起一个本地静态服务（优先用 python，否则用自带的 node 服务），跑完关掉。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var PORT = Number(process.env.WB_HTTP_PORT || 8899);
var CDP_PORT = Number(process.env.WB_PORT || 9335);

var BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];
var BROWSER = BROWSERS.filter(function (p) { return fs.existsSync(p); })[0];
if (!BROWSER) { console.error('未找到 Edge/Chrome，跳过 HTTP 自检。'); process.exit(0); }

/* ---------------- 自带一个极简静态服务，避免依赖 python ---------------- */
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

var server = http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  var rel = urlPath === '/' ? '/工作台.html' : urlPath;
  var abs = path.join(ROOT, rel);
  // 防目录穿越
  if (abs.indexOf(ROOT) !== 0) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(abs, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found: ' + rel); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(data);
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
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function waitForDebugger(tries) {
  return getJson('/json/version').catch(function (e) {
    if (tries <= 0) throw e;
    return sleep(300).then(function () { return waitForDebugger(tries - 1); });
  });
}

/* ---------------- 极简 CDP ---------------- */
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
        return new Promise(function (res2) {
          var myId = ++id;
          pending[myId] = res2;
          var payload = Buffer.from(JSON.stringify({ id: myId, method: method, params: params || {} }));
          var header, mask = Buffer.from([0, 0, 0, 0]), len = payload.length;
          if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
          else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
          else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
          socket.write(Buffer.concat([header, mask, payload]));
        });
      }
      socket.on('data', function (chunk) {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          var op = buf[0] & 0x0f;
          var masked = (buf[1] & 0x80) !== 0;
          var len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (masked) off += 4;
          if (buf.length < off + len) return;
          var p2 = buf.slice(off, off + len);
          buf = buf.slice(off + len);
          if (op === 8) { socket.end(); continue; }
          if (op !== 1) continue;
          var msg;
          try { msg = JSON.parse(p2.toString('utf8')); } catch (e) { continue; }
          if (msg.id && pending[msg.id]) { pending[msg.id](msg.result || msg.error); delete pending[msg.id]; }
        }
      });
      socket.on('error', reject);
      resolve({ send: send, close: function () { socket.end(); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });
  var base = 'http://127.0.0.1:' + PORT + '/';
  console.log('本地静态服务: ' + base + '（模拟 GitHub Pages）');

  // 先确认服务本身能返回中文路径资源
  var probed = await new Promise(function (resolve) {
    http.get(base + encodeURIComponent('数据/schema.js'), function (res) {
      resolve({ code: res.statusCode, type: res.headers['content-type'] });
    }).on('error', function () { resolve({ code: 0 }); });
  });
  record('静态服务能返回中文路径资源', probed.code === 200, 'HTTP ' + probed.code + ' ' + probed.type);

  var prof = path.join(os.tmpdir(), 'wbhttp-prof');
  fs.rmSync(prof, { recursive: true, force: true });
  var child = cp.spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + prof,
    '--window-size=1280,900', base + encodeURIComponent('工作台.html')
  ], { stdio: 'ignore' });

  await waitForDebugger(40);
  var targets = await getJson('/json/list');
  var page = targets.filter(function (t) { return t.type === 'page'; })[0];
  if (!page) throw new Error('没有可用的页面目标');

  var cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  async function ev(expr) {
    var out = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (out.exceptionDetails) {
      throw new Error((out.exceptionDetails.exception || {}).description || out.exceptionDetails.text);
    }
    return out.result ? out.result.value : undefined;
  }

  // 收集控制台报错与失败请求
  await ev('(function(){window.__errs=[];window.__fails=[];' +
    'window.addEventListener("error",function(e){window.__errs.push(String(e.message||e));});' +
    'window.addEventListener("unhandledrejection",function(e){window.__errs.push("rejection:"+String(e.reason));});})()');

  for (var i = 0; i < 40; i++) {
    if (await ev('document.readyState === "complete" && typeof CP === "object" && !!CP.ui')) break;
    await sleep(250);
  }

  record('页面在 HTTP 下加载完成', await ev('document.readyState') === 'complete');
  record('CP.ui 就绪（14 个脚本全部按顺序加载）', await ev('typeof CP === "object" && !!CP.ui'));
  record('导航渲染出 9 项', (await ev('document.getElementById("nav").children.length')) === 9);
  record('首页内容已渲染', (await ev('document.getElementById("view").textContent.length')) > 200);

  var errs = await ev('window.__errs');
  record('加载过程无 JS 报错', !errs || errs.length === 0, (errs && errs.length) ? errs.slice(0, 3).join(' | ') : '');

  // 关键：HTTP 下 fetch 相对路径取封面图并转 base64
  var asset = await ev('CP.report.assetDataUri("素材/cover.png").then(function(u){' +
    'return {len:(u||"").length, head:String(u||"").slice(0,30)};})');
  record('HTTP 下能 fetch 素材并转 base64（打印视图封面依赖它）',
    asset && asset.len > 1000, asset ? 'base64 长度 ' + asset.len : '返回空');
  record('base64 前缀正确', asset && asset.head.indexOf('data:image/png;base64,') === 0,
    asset ? asset.head : '');

  // 真实走一遍生成打印视图（window.open 在 HTTP 下的路径）
  var printLen = await ev('(function(){' +
    'var stub={open:function(){window.__ph="";},write:function(h){window.__ph+=h;},close:function(){}};' +
    'var w={document:stub,focus:function(){},print:function(){},close:function(){}};' +
    'CP.report.renderPrintView(w, CP.demoArchive(), CP.ui.result(), "data:image/png;base64,AAAA");' +
    'return (window.__ph||"").length;})()');
  record('打印视图在 HTTP 下可生成', printLen > 3000, 'HTML 长度 ' + printLen);

  // 素材是否真的以 200 加载（用 Image 探一次）
  var imgOk = await ev('new Promise(function(res){' +
    'var im=new Image();im.onload=function(){res(im.naturalWidth>0);};' +
    'im.onerror=function(){res(false);};im.src="素材/hero.png";})');
  record('素材图能在 HTTP 下正常加载', imgOk === true);

  cdp.close();
  try { child.kill(); } catch (e) { }
  server.close();
  var fails = results.filter(function (x) { return !x; }).length;
  console.log('\n== ' + (fails === 0 ? '全部通过' : fails + ' 项失败') + ' ==');
  return fails;
}

main().then(function (f) {
  process.exit(f === 0 ? 0 : 1);
}).catch(function (e) {
  console.error('HTTP 自检失败：' + e.message);
  try { server.close(); } catch (e2) { }
  process.exit(1);
});
