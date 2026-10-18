/*!
 * Luna — MMSEG 分词(wasm) + MKB2 多阶混合马尔科夫链生成。
 *
 * 与原生 markov_gen.c / friso 位级对齐：
 *  - 分词：luna.wasm（friso C 编译，词以 0x1f 分隔）
 *  - 生成：3 阶 CSR 回退（tri/bi/uni），xorshift32 + 与 C 完全一致的取整采样
 *
 * X 模式接缝：同一个引擎可装载任意 MKB2 字节（emo8 为 8 链，按 chain 索引取情感维），
 * 当前仅内置 neutral3322（nchains=1）。
 */
(function (global) {
  'use strict';

  var EOS_ID = 1;          // </s>
  var MAX_GEN = 120;
  var DEFAULT_RNG = 20261013;

  /* ---------------- base64 / utf8 ---------------- */

  function b64ToBytes(s) {
    if (typeof atob === 'function') {
      var bin = atob(s);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i) & 0xff;
      return out;
    }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }

  var te = new TextEncoder();
  var td = new TextDecoder('utf-8');

  /* ---------------- MKB2 多阶链 ---------------- */

  function MKB2(u8) {
    this.buf = u8;
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.dv = dv;

    var magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== 'MKB2') throw new Error('Luna: bad MKB2 magic: ' + magic);
    this.version = dv.getUint32(4, true);
    this.order = dv.getUint32(8, true);
    this.nchains = dv.getUint32(12, true);
    this.V = dv.getUint32(16, true);
    this.chainsOff = Number(dv.getBigUint64(20, true));
    this.vocabOff = Number(dv.getBigUint64(28, true));

    this.chains = [];
    for (var ci = 0; ci < this.nchains; ++ci) {
      var b = this.chainsOff + ci * 128;
      var nameEnd = b;
      while (nameEnd < b + 48 && u8[nameEnd] !== 0) ++nameEnd;
      var name = td.decode(u8.subarray(b, nameEnd));
      var chain = { name: name, nTokens: Number(dv.getBigUint64(b + 48, true)),
                    lv: [] };
      for (var o = 0; o < this.order; ++o) {
        var p = b + 56 + o * 16;
        chain.lv.push({
          kc: o + 1,
          off: Number(dv.getBigUint64(p, true)),
          nstates: dv.getUint32(p + 8, true),
          nedges: dv.getUint32(p + 12, true)
        });
      }
      this.chains.push(chain);
    }

    var vp = this.vocabOff;
    var vc = dv.getUint32(vp, true);
    vp += 4;
    this.words = new Array(vc);
    for (var id = 0; id < vc; ++id) {
      var L = dv.getUint32(vp, true);
      vp += 4;
      this.words[id] = td.decode(u8.subarray(vp, vp + L));
      vp += L;
    }
    this.wordId = Object.create(null);
    for (var w = 0; w < this.words.length; ++w) this.wordId[this.words[w]] = w;
  }

  MKB2.prototype.findState = function (lv, keys) {
    var dv = this.dv, kc = lv.kc;
    var keyBase = lv.off;
    var rangeBase = keyBase + lv.nstates * kc * 4;
    var lo = 0, hi = lv.nstates;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      var kp = keyBase + mid * kc * 4;
      var cmp = 0;
      for (var j = 0; j < kc; ++j) {
        var a = keys[j];
        var bv = dv.getUint32(kp + j * 4, true);
        if (a < bv) { cmp = -1; break; }
        if (a > bv) { cmp = 1; break; }
      }
      if (cmp < 0) hi = mid;
      else if (cmp > 0) lo = mid + 1;
      else return {
        beg: dv.getUint32(rangeBase + mid * 4, true),
        end: dv.getUint32(rangeBase + (mid + 1) * 4, true)
      };
    }
    return null;
  };

  MKB2.prototype.edgeTarget = function (lv, edge) {
    var toBase = lv.off + lv.nstates * lv.kc * 4 + (lv.nstates + 1) * 4;
    return this.dv.getUint32(toBase + edge * 4, true);
  };

  MKB2.prototype.edgeCount = function (lv, edge) {
    var toBase = lv.off + lv.nstates * lv.kc * 4 + (lv.nstates + 1) * 4;
    var cntBase = toBase + lv.nedges * 4;
    return this.dv.getUint16(cntBase + edge * 2, true);
  };

  /* 在 [beg,end) 内按 C 语义采样：r = (xs32()%1e9)*tot/1e9，u64 整除 */
  MKB2.prototype.pickEdge = function (lv, beg, end, xs) {
    var tot = 0n;
    for (var e = beg; e < end; ++e) tot += BigInt(this.edgeCount(lv, e));
    var target = BigInt(xs() % 1000000000) * tot / 1000000000n;
    var acc = 0n;
    for (var k = beg; k < end; ++k) {
      acc += BigInt(this.edgeCount(lv, k));
      if (acc > target) return this.edgeTarget(lv, k);
    }
    return this.edgeTarget(lv, end - 1);
  };

  /**
   * 生成（同步，与 markov_gen.c 逐 token 一致）。
   * @param seedIds 已在词表中的种子词号
   * @param opt {chain,sample,rngBase,onToken,shouldStop}
   */
  MKB2.prototype.generate = function (seedIds, opt) {
    opt = opt || {};
    var chainIdx = opt.chain || 0;
    var s = opt.sample >>> 0;
    var rngBase = (opt.rngBase == null ? DEFAULT_RNG : opt.rngBase) >>> 0;
    var chain = this.chains[chainIdx];
    if (!chain) throw new Error('Luna: chain index out of range: ' + chainIdx);

    var self = this;
    var x = (Math.imul(chainIdx, 2654435761) +
             Math.imul(s, 40503) + rngBase + 1) >>> 0;
    function xs() {
      x = (x ^ (x << 13)) >>> 0;
      x = (x ^ (x >>> 17)) >>> 0;
      x = (x ^ (x << 5)) >>> 0;
      return x;
    }

    var c0 = 0, c1 = 0, c2 = 0;
    for (var i = 0; i < seedIds.length; ++i) { c0 = c1; c1 = c2; c2 = seedIds[i]; }

    var tokens = [];
    var reason = 'maxlen';
    for (var step = 0; step < MAX_GEN; ++step) {
      if (opt.shouldStop && opt.shouldStop()) { reason = 'stop'; break; }
      var lv = null, keys = null, hit = null;
      /* 与 markov_gen.c 一致：无条件按 3→2→1 阶回退（BOS=0 也参与成键） */
      lv = chain.lv[2]; keys = [c0, c1, c2]; hit = this.findState(lv, keys);
      if (!hit) { lv = chain.lv[1]; keys = [c1, c2]; hit = this.findState(lv, keys); }
      if (!hit) { lv = chain.lv[0]; keys = [c2]; hit = this.findState(lv, keys); }
      if (!hit || hit.beg === hit.end) { reason = 'dead'; break; }

      var nx = this.pickEdge(lv, hit.beg, hit.end, xs);
      if (nx >= this.V) throw new Error('Luna: corrupt edge target ' + nx);
      c0 = c1; c1 = c2; c2 = nx;
      if (nx === EOS_ID) { reason = 'eos'; break; }
      var word = this.words[nx];
      tokens.push(word);
      if (opt.onToken) opt.onToken(word, step, tokens);
    }
    return { tokens: tokens, text: tokens.join(''), reason: reason, self: self };
  };

  /* ---------------- 引擎 ---------------- */

  function Engine(ex, model) {
    this.ex = ex;
    this.model = model;
    var mem = ex.memory;
    this.mem = mem;
    this.buf = (len) => ex.luna_buf(len >>> 0);
    this.free = (p) => ex.luna_buf_free(p);
  }

  Engine.prototype._write = function (bytes) {
    var p = this.buf(bytes.length + 1);
    new Uint8Array(this.mem.buffer).set(bytes, p);
    new Uint8Array(this.mem.buffer)[p + bytes.length] = 0;
    return p;
  };

  /** MMSEG 分词，返回 token 数组（英文小写，与训练侧一致）。 */
  Engine.prototype.segment = function (text) {
    var bytes = te.encode(text);
    var tp = this._write(bytes);
    var cap = Math.max(1024, bytes.length * 2 + 2);
    var op = this.buf(cap);
    var r;
    try {
      r = this.ex.luna_segment(tp, op, cap);
    } finally {
      this.free(tp);
    }
    if (r < 0) {
      this.free(op);
      throw new Error('Luna: segment failed, code ' + r);
    }
    var u8 = new Uint8Array(this.mem.buffer);
    var end = op;
    while (u8[end] !== 0) ++end;
    var raw = u8.subarray(op, end);
    this.free(op);
    if (raw.length === 0) return [];
    var parts = [];
    var start = 0;
    for (var i = 0; i < raw.length; ++i) {
      if (raw[i] === 0x1f) { parts.push(td.decode(raw.subarray(start, i))); start = i + 1; }
    }
    parts.push(td.decode(raw.subarray(start)));
    return parts;
  };

  /** 种子归一化：MMSEG 后丢弃 OOV，返回词号；oov 收集未登录词。 */
  Engine.prototype.seedIds = function (text, oov) {
    var toks = this.segment(text);
    var ids = [];
    for (var i = 0; i < toks.length; ++i) {
      var id = this.model.wordId[toks[i]];
      if (id !== undefined && id !== EOS_ID) ids.push(id);
      else if (oov) oov.push(toks[i]);
    }
    return ids;
  };

  /**
   * 对话续写。onToken 逐词回调（可用于流式/中止）。
   * 返回 {text,tokens,reason,seedIds,seedText,oov}
   */
  Engine.prototype.reply = function (text, opt) {
    opt = opt || {};
    var oov = [];
    var ids = this.seedIds(text, oov);
    var gen = this.model.generate(ids, {
      chain: opt.chain, sample: opt.sample, rngBase: opt.rngBase,
      onToken: opt.onToken, shouldStop: opt.shouldStop
    });
    return {
      text: gen.text,
      tokens: gen.tokens,
      reason: gen.reason,
      seedIds: ids,
      seedText: ids.map((id) => this.model.words[id]).join(''),
      oov: oov
    };
  };

  /* ---------------- 装载 ---------------- */

  async function createEngine(wasmBytes, dictBytes, modelBytes, opt) {
    opt = opt || {};
    var memRef = { mem: null };
    function readCstr(ptr) {
      var u8 = new Uint8Array(memRef.mem.buffer);
      var end = ptr;
      while (u8[end] !== 0) ++end;
      return td.decode(u8.subarray(ptr, end));
    }
    var imports = {
      env: {
        luna_panic: function (ptr) { throw new Error('Luna native panic: ' + readCstr(ptr)); },
        luna_log: function (ptr) {
          if (typeof opt.log === 'function') opt.log(readCstr(ptr));
        }
      }
    };
    var inst = await WebAssembly.instantiate(wasmBytes, imports);
    var ex = inst.instance ? inst.instance.exports : inst.exports;
    memRef.mem = ex.memory;

    var pp = ex.luna_buf(dictBytes.length);
    new Uint8Array(ex.memory.buffer).set(dictBytes, pp);
    var n = ex.luna_load_pack(pp, dictBytes.length);
    if (n <= 0) throw new Error('Luna: load_pack failed, code ' + n);

    var ini = te.encode('friso.ini');
    var ip = ex.luna_buf(ini.length + 1);
    var m8 = new Uint8Array(ex.memory.buffer);
    m8.set(ini, ip);
    m8[ip + ini.length] = 0;
    if (ex.luna_init(ip) !== 1) throw new Error('Luna: luna_init failed');
    ex.luna_buf_free(ip);

    var model = new MKB2(modelBytes);
    return new Engine(ex, model);
  }

  /* 版本号：随构建更新，挂在所有资产 URL 上，防止 CDN 边缘缓存新旧错配。
     资产变动时与 index.html 里的 v 一起递增 */
  var ASSET_VERSION = '20261016c';

  /* emo8 情感链索引（与 markov_emo8.bin 内链名一一对应）。
     neutral3322 只有 1 条链（中性），emo8 则是八维情感链。 */
  var EMO8_CHAINS = ['乐', '好', '怒', '哀', '惧', '恶', '惊', '中性'];

  /* 本脚本所在目录（普通 <script> 执行期 currentScript 有效；
     去掉可能存在的 ?v= 查询再取目录） */
  var PLUGIN_BASE = (function () {
    try {
      if (typeof document !== 'undefined' && document.currentScript &&
          document.currentScript.src) {
        return document.currentScript.src.split('?')[0].replace(/[^/]*$/, '');
      }
    } catch (e) {}
    return 'plugins/luna/';
  })();

  /* 静态部署下的独立资产路径（模型在 queshi/models/luna/）。
     gz 为预压文件（gzip -9），浏览器支持 DecompressionStream 时优先，
     体积约为原始的 30%，弱网下是生死线 */
  var ASSET_SPECS = [
    { key: 'wasm',  raw: 'luna.wasm',                              gz: null,
      sizeRaw: 26791,  sizeGz: 26791,
      magic: [0x00, 0x61, 0x73, 0x6d] },
    { key: 'dict',  raw: 'assets/dict.pack',                       gz: 'assets/dict.pack.gz',
      sizeRaw: 2661604, sizeGz: 775856,
      magic: [0x4c, 0x44, 0x49, 0x43] },
    { key: 'model', raw: '../../models/luna/markov_neutral3322.bin', gz: '../../models/luna/markov_neutral3322.bin.gz',
      sizeRaw: 3443704, sizeGz: 1076494,
      magic: [0x4d, 0x4b, 0x42, 0x32] }
  ];

  /* emo8：八情感链大模型 (~15.6MB / gz 4.8MB)，
     单独定义，不跟默认 neutral 一起下——用户开 X(boost) 时按需拉取 */
  var EMO8_SPEC = { key: 'emo8', raw: '../../models/luna/markov_emo8.bin',
    gz: '../../models/luna/markov_emo8.bin.gz',
    sizeRaw: 15641190, sizeGz: 5043838,
    magic: [0x4d, 0x4b, 0x42, 0x32] };

  var FETCH_TIMEOUT = 150000;   /* 单文件总超时（弱网阈值约 7KB/s） */
  var FETCH_RETRIES = 1;        /* 单候选失败重试次数 */

  function hasCache() {
    return typeof caches !== 'undefined' && caches && typeof caches.open === 'function';
  }
  function hasGunzip() {
    return typeof DecompressionStream !== 'undefined';
  }

  function assetUrl(rel, base) {
    var u = new URL(rel, base);
    u.search = u.search ? u.search + '&v=' + ASSET_VERSION : '?v=' + ASSET_VERSION;
    return u.href;
  }

  function magicOk(bytes, magic) {
    if (!bytes || bytes.length < magic.length) return false;
    for (var i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
    return true;
  }

  async function gunzip(bytes) {
    var ds = new DecompressionStream('gzip');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* Cache Storage：成功拿到的资产（解压后原始字节）按版本缓存，
     二次访问零下载；内联兜底成功后也回填，弱网用户第二次即离线可用 */
  async function cacheGet(keyUrl) {
    if (!hasCache()) return null;
    try {
      var c = await caches.open('luna-assets-' + ASSET_VERSION);
      var r = await c.match(keyUrl);
      if (r) return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      try { console.error('[Luna cache] cacheGet 异常:', keyUrl, e); } catch (_) {}
    }
    return null;
  }
  async function cachePut(keyUrl, bytes) {
    if (!hasCache()) return;
    try {
      var c = await caches.open('luna-assets-' + ASSET_VERSION);
      await c.put(keyUrl, new Response(bytes, {
        headers: { 'Content-Type': 'application/octet-stream' }
      }));
    } catch (e) {
      try { console.error('[Luna cache] cachePut 异常:', keyUrl, e); } catch (_) {}
    }
  }

  /* 流式下载：拿得到进度；单文件 150 秒超时 + 重试 1 次
     第 4 个参数 externalSignal：外部取消信号（用户取消时立即中断） */
  async function fetchStream(url, onProgress, attempt, externalSignal) {
    attempt = attempt || 0;
    var ctrl = null, timer = 0;
    try {
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT);
        if (externalSignal && externalSignal.aborted) { ctrl.abort(); }
        else if (externalSignal) {
          externalSignal.addEventListener('abort', function () { ctrl.abort(); }, { once: true });
        }
      }
      var resp = await fetch(url, {
        cache: 'force-cache',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var total = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
      if (resp.body && resp.body.getReader) {
        var reader = resp.body.getReader();
        var chunks = [];
        var loaded = 0;
        for (;;) {
          if (externalSignal && externalSignal.aborted) {
            throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
          }
          var step = await reader.read();
          if (step.done) break;
          chunks.push(step.value);
          loaded += step.value.length;
          if (onProgress) onProgress(loaded, total);
        }
        var out = new Uint8Array(loaded);
        var off = 0;
        for (var i = 0; i < chunks.length; i++) {
          out.set(chunks[i], off);
          off += chunks[i].length;
        }
        return out;
      }
      return new Uint8Array(await resp.arrayBuffer());
    } catch (e) {
      if (externalSignal && externalSignal.aborted) {
        var ae = new Error('Aborted'); ae.name = 'AbortError'; throw ae;
      }
      if (attempt < FETCH_RETRIES) {
        await new Promise(function (r) { setTimeout(r, 500); });
        return fetchStream(url, onProgress, attempt + 1, externalSignal);
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* 单资产：缓存 → 预压 gz → 原始文件；文件头校验防劫持/错误页 */
  async function getAsset(spec, base, progress, opt) {
    opt = opt || {};
    var keyUrl = assetUrl(spec.raw, base);
    var cached = await cacheGet(keyUrl);
    if (magicOk(cached, spec.magic)) {
      progress.slots[spec.key] = { ratio: 1 };
      if (opt.onProgress) opt.onProgress({ phase: 'download', progress: progress.pct() });
      return cached;
    }
    var candidates = [];
    if (spec.gz && hasGunzip()) candidates.push({ url: assetUrl(spec.gz, base), gz: true });
    candidates.push({ url: keyUrl, gz: false });

    var lastErr = null;
    for (var ci = 0; ci < candidates.length; ci++) {
      var cand = candidates[ci];
      try {
        var expected = cand.gz ? spec.sizeGz : spec.sizeRaw;
        var bytes = await fetchStream(cand.url, function (loaded) {
          progress.slots[spec.key] = { ratio: Math.min(1, loaded / expected) };
          if (opt.onProgress) opt.onProgress({ phase: 'download', progress: progress.pct() });
        }, 0, opt.signal);
        if (cand.gz) bytes = await gunzip(bytes);
        if (!magicOk(bytes, spec.magic)) throw new Error('bad magic (文件被篡改或返回错误页)');
        await cachePut(keyUrl, bytes);
        progress.slots[spec.key] = { ratio: 1 };
        if (opt.onProgress) opt.onProgress({ phase: 'download', progress: progress.pct() });
        return bytes;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        if (typeof opt.log === 'function') {
          opt.log('资产 ' + spec.key + (cand.gz ? ' (.gz)' : '') + ' 失败：' + (e && e.message));
        }
      }
    }
    throw lastErr || new Error('asset ' + spec.key + ' unavailable');
  }

  /* 动态注入 luna-assets.js（仅独立通道失败时加载，省常态流量）。
     弱网下 8MB 也可能断：180 秒看门狗 + 最多 2 次尝试 */
  var embeddedPromise = null;
  function loadEmbeddedScript(opt) {
    if (typeof global.__LUNA_ASSETS__ !== 'undefined') return Promise.resolve();
    if (embeddedPromise) return embeddedPromise;
    embeddedPromise = (async function () {
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          await new Promise(function (resolve, reject) {
            if (typeof document === 'undefined') { reject(new Error('no document')); return; }
            var s = document.createElement('script');
            var done = false;
            var timer = setTimeout(function () {
              if (done) return;
              done = true;
              s.remove();
              reject(new Error('下载超时（180s）'));
            }, 180000);
            s.onload = function () {
              if (done) return;
              done = true;
              clearTimeout(timer);
              if (typeof global.__LUNA_ASSETS__ !== 'undefined') resolve();
              else reject(new Error('已加载但无资产数据'));
            };
            s.onerror = function () {
              if (done) return;
              done = true;
              clearTimeout(timer);
              s.remove();
              reject(new Error('下载中断'));
            };
            s.src = assetUrl('luna-assets.js', PLUGIN_BASE);
            document.head.appendChild(s);
          });
          return;
        } catch (e) {
          if (typeof opt.log === 'function') {
            opt.log('内联包第 ' + (attempt + 1) + ' 次尝试失败：' + (e && e.message));
          }
          await new Promise(function (r) { setTimeout(r, 600); });
        }
      }
      throw new Error('内联包多次下载失败');
    })().catch(function (e) { embeddedPromise = null; throw e; });
    return embeddedPromise;
  }

  function decodeAsset(v) {
    return v instanceof Uint8Array ? v : b64ToBytes(v);
  }

  /* 内联包成功后回填缓存：下次访问（即使独立文件被墙/断网）也零下载 */
  function backfillCache(decoded, base) {
    if (!hasCache()) return;
    ASSET_SPECS.forEach(function (spec) {
      var bytes = decoded[spec.key];
      if (magicOk(bytes, spec.magic)) cachePut(assetUrl(spec.raw, base), bytes);
    });
  }

  async function fromEmbedded(opt, base) {
    await loadEmbeddedScript(opt);
    var A = global.__LUNA_ASSETS__;
    var decoded = {
      wasm: decodeAsset(A.wasm),
      dict: decodeAsset(A.dict),
      model: decodeAsset(A.m3322)
    };
    var engine = await createEngine(decoded.wasm, decoded.dict, decoded.model, opt);
    backfillCache(decoded, base);
    return engine;
  }

  function progressTracker() {
    return {
      slots: {},
      pct: function () {
        var keys = Object.keys(this.slots);
        if (!keys.length) return 0;
        var sum = 0;
        for (var i = 0; i < keys.length; i++) sum += this.slots[keys[i]].ratio;
        return sum / keys.length;
      }
    };
  }

  /**
   * 装载默认中性引擎：
   *  - http(s)：缓存 → 预压 .gz（约 1.8MB）→ 原始文件 → 8MB 内联包兜底
   *  - file://：页面已直接内联 luna-assets.js
   * 成功后所有资产进入 Cache Storage，二次访问零下载
   *  opt.onProgress({phase:'download'|'fallback'|'init', progress:0..1})
   */
  async function loadDefault(opt) {
    opt = opt || {};
    var base = opt.baseUrl || PLUGIN_BASE;
    var isHttp = typeof location !== 'undefined' &&
                 (location.protocol === 'http:' || location.protocol === 'https:');
    if (isHttp && !opt.embedded) {
      try {
        var progress = progressTracker();
        if (opt.onProgress) opt.onProgress({ phase: 'download', progress: 0 });
        var parts = await Promise.all(ASSET_SPECS.map(function (spec) {
          return getAsset(spec, base, progress, opt);
        }));
        if (opt.onProgress) opt.onProgress({ phase: 'init', progress: 1 });
        return await createEngine(parts[0], parts[1], parts[2], opt);
      } catch (e) {
        if (typeof opt.log === 'function') {
          opt.log('独立资产加载失败，回退内联包：' + (e && e.message));
        }
        if (opt.onProgress) opt.onProgress({ phase: 'fallback', progress: 0 });
        try {
          return await fromEmbedded(opt, base);
        } catch (e2) {
          throw new Error('模型文件下载失败（网络不稳定或被中断）。请换更稳定的网络后再点一次发送——已下载的部分会被缓存，第二次通常成功。详情：'
                          + (e2 && e2.message ? e2.message : e2));
        }
      }
    }
    return fromEmbedded(opt, base);
  }

  /**
   * 装载 emo8 八情感链引擎（纯缓存模式，不主动下载）。
   * 前提：wasm + dict 必须已在 Cache Storage 中（neutral 首次加载时写入），
   *       emo8 模型也必须已被预缓存。任何一个缓存缺失都抛 EMO8_NOT_CACHED。
   *       不会触发任何 fetch。
   */
  async function loadEmo8(opt) {
    opt = opt || {};
    var base = opt.baseUrl || PLUGIN_BASE;
    var progress = progressTracker();

    var wasmKey = assetUrl(ASSET_SPECS[0].raw, base);
    var dictKey = assetUrl(ASSET_SPECS[1].raw, base);
    var emo8Key = assetUrl(EMO8_SPEC.raw, base);

    if (opt.onProgress) opt.onProgress({ phase: 'download', progress: 0 });

    var wasmCached = await cacheGet(wasmKey);
    if (!magicOk(wasmCached, ASSET_SPECS[0].magic)) {
      throw new Error('EMO8_NOT_CACHED:wasm');
    }
    progress.slots.wasm = { ratio: 0.33 };

    var dictCached = await cacheGet(dictKey);
    if (!magicOk(dictCached, ASSET_SPECS[1].magic)) {
      throw new Error('EMO8_NOT_CACHED:dict');
    }
    progress.slots.dict = { ratio: 0.66 };

    var emo8Cached = await cacheGet(emo8Key);
    if (!magicOk(emo8Cached, EMO8_SPEC.magic)) {
      throw new Error('EMO8_NOT_CACHED:emo8');
    }
    progress.slots.emo8 = { ratio: 1 };

    if (opt.onProgress) opt.onProgress({ phase: 'init', progress: 1 });
    return await createEngine(wasmCached, dictCached, emo8Cached, opt);
  }

  /**
   * 下载 emo8 模型并缓存（供 X 模式使用）。
   *   - 先确保 wasm + dict 已在缓存中（未缓存则自动下载）
   *   - 再下载 emo8 模型（走预压 .gz 优先，约 4.8MB / 原始 15.6MB）
   *   - 全部写入 Cache Storage，完成后 loadEmo8 即可直接命中
   * opt.onProgress({phase:'ensure'|'download'|'init', progress:0..1, label})
   *   其中 progress 为整体加权进度（wasm+dict 占 40%，emo8 占 60%）
   *   抛出 abortError 时表示用户取消，调用方可直接忽略
   */
  async function downloadEmo8(opt) {
    opt = opt || {};
    var base = opt.baseUrl || PLUGIN_BASE;
    var progress = progressTracker();
    var abortSignal = opt.signal || null;

    function emit(phase, progress01, label) {
      if (opt.onProgress) opt.onProgress({
        phase: phase, progress: progress01, label: label || ''
      });
    }

    function checkAbort() {
      if (abortSignal && abortSignal.aborted) {
        var e = new Error('Aborted');
        e.name = 'AbortError';
        throw e;
      }
    }

    /* 先检查 wasm + dict 是否已缓存 */
    var wasmKey = assetUrl(ASSET_SPECS[0].raw, base);
    var dictKey = assetUrl(ASSET_SPECS[1].raw, base);
    var emo8Key = assetUrl(EMO8_SPEC.raw, base);

    var wasmCached = await cacheGet(wasmKey);
    var dictCached = await cacheGet(dictKey);
    var wasmOk = magicOk(wasmCached, ASSET_SPECS[0].magic);
    var dictOk = magicOk(dictCached, ASSET_SPECS[1].magic);

    /* emo8 已缓存 → 直接返回 */
    var emo8Cached = await cacheGet(emo8Key);
    if (magicOk(emo8Cached, EMO8_SPEC.magic)) {
      emit('init', 1, 'X 模型已就绪');
      return { alreadyCached: true };
    }

    checkAbort();

    /* 阶段 1：确保 wasm + dict 缓存（占总进度 40%） */
    if (!wasmOk || !dictOk) {
      emit('ensure', 0.02, '装载引擎核心…');
      var ensureProgress = progressTracker();
      var ensureParts = [];
      var specsToGet = [];
      if (!wasmOk) specsToGet.push({ spec: ASSET_SPECS[0], idx: 0 });
      if (!dictOk) specsToGet.push({ spec: ASSET_SPECS[1], idx: 1 });

      var baseScale = 0.4;  /* 确保阶段占 40% */
      var innerOpt = {
        log: opt.log,
        signal: abortSignal,
        onProgress: function (s) {
          var innerPct = s.progress || 0;
          var overall = 0.02 + innerPct * baseScale;
          emit('ensure', overall, '装载引擎核心…');
        }
      };

      for (var i = 0; i < specsToGet.length; i++) {
        checkAbort();
        var item = specsToGet[i];
        innerOpt.onProgress = function (s) {
          var innerPct = s.progress || 0;
          var overall = 0.02 + innerPct * baseScale;
          emit('ensure', overall, '装载引擎核心…');
        };
        await getAsset(item.spec, base, ensureProgress, innerOpt);
      }
      emit('ensure', 0.4, '引擎核心就绪');
    }

    checkAbort();

    /* 阶段 2：下载 emo8（占总进度 60%） */
    emit('download', 0.42, '下载 LunaX 模型…');
    var emo8Progress = progressTracker();
    var emo8Opt = {
      log: opt.log,
      signal: abortSignal,
      onProgress: function (s) {
        var innerPct = s.progress || 0;
        var overall = 0.4 + innerPct * 0.6;
        var pct = Math.round(innerPct * 100);
        emit('download', overall, '下载 LunaX 模型… ' + pct + '%');
      }
    };

    /* 临时把 abort signal 传给 fetchStream：改造 getAsset 调用链 */
    /* 为了不侵入现有 getAsset 签名，这里直接复制一段带 abort 的下载 */
    var bytes = null;
    var candidates = [];
    if (EMO8_SPEC.gz && hasGunzip()) {
      candidates.push({ url: assetUrl(EMO8_SPEC.gz, base), gz: true });
    }
    candidates.push({ url: emo8Key, gz: false });

    var lastErr = null;
    for (var ci = 0; ci < candidates.length; ci++) {
      checkAbort();
      var cand = candidates[ci];
      try {
        var expected = cand.gz ? EMO8_SPEC.sizeGz : EMO8_SPEC.sizeRaw;
        bytes = await fetchStream(cand.url, function (loaded) {
          emo8Progress.slots.emo8 = { ratio: Math.min(1, loaded / expected) };
          emo8Opt.onProgress({ progress: emo8Progress.pct() });
        }, 0, abortSignal);
        if (cand.gz) bytes = await gunzip(bytes);
        if (!magicOk(bytes, EMO8_SPEC.magic)) {
          throw new Error('bad magic（文件被篡改或返回错误页）');
        }
        break;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        if (opt.log) opt.log('emo8 ' + (cand.gz ? '.gz' : '') + ' 下载失败：' + (e && e.message));
      }
    }
    if (!bytes) throw lastErr || new Error('emo8 模型下载失败');

    checkAbort();
    await cachePut(emo8Key, bytes);
    emit('init', 1, 'X 模型下载完成');
    return { ok: true };
  }

  var Luna = {
    createEngine: createEngine,
    loadDefault: loadDefault,
    loadEmo8: loadEmo8,
    downloadEmo8: downloadEmo8,
    b64ToBytes: b64ToBytes,
    MKB2: MKB2,
    EOS_ID: EOS_ID,
    MAX_GEN: MAX_GEN,
    EMO8_CHAINS: EMO8_CHAINS,
    PLUGIN_BASE: PLUGIN_BASE,
    ASSET_VERSION: ASSET_VERSION,
    EMO8_SPEC: EMO8_SPEC
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Luna;
  global.Luna = Luna;
})(typeof globalThis !== 'undefined' ? globalThis : this);
