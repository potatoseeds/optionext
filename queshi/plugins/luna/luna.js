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

  /* 版本号：随构建更新，挂在所有资产 URL 上，防止 CDN 边缘缓存新旧错配 */
  var ASSET_VERSION = '20261015a';

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

  /* 静态部署下的独立资产路径（模型在 queshi/models/luna/） */
  var ASSET_FILES = {
    wasm: 'luna.wasm',
    dict: 'assets/dict.pack',
    model: '../../models/luna/markov_neutral3322.bin'
  };

  function assetUrl(rel, base) {
    var u = new URL(rel, base);
    u.search = u.search ? u.search + '&v=' + ASSET_VERSION : '?v=' + ASSET_VERSION;
    return u.href;
  }

  /* 大文件（词典 2.6MB / 模型 3.4MB，经 CDN 回源可能较慢）：
     60 秒超时 + 失败重试 1 次 */
  async function fetchBytes(url, attempt) {
    attempt = attempt || 0;
    var ctrl = null, timer = 0;
    try {
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        timer = setTimeout(function () { ctrl.abort(); }, 60000);
      }
      var resp = await fetch(url, {
        cache: 'force-cache',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + url);
      return new Uint8Array(await resp.arrayBuffer());
    } catch (e) {
      if (attempt < 1) {
        await new Promise(function (r) { setTimeout(r, 400); });
        return fetchBytes(url, attempt + 1);
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* 动态注入 luna-assets.js（仅在独立文件通道失败时才加载，省 8MB 常态流量） */
  var embeddedPromise = null;
  function loadEmbeddedScript() {
    if (typeof global.__LUNA_ASSETS__ !== 'undefined') return Promise.resolve();
    if (embeddedPromise) return embeddedPromise;
    embeddedPromise = new Promise(function (resolve, reject) {
      if (typeof document === 'undefined') { reject(new Error('no document')); return; }
      var s = document.createElement('script');
      s.src = assetUrl('luna-assets.js', PLUGIN_BASE);
      s.onload = function () {
        if (typeof global.__LUNA_ASSETS__ !== 'undefined') resolve();
        else reject(new Error('luna-assets.js loaded but no __LUNA_ASSETS__'));
      };
      s.onerror = function () { reject(new Error('luna-assets.js load error')); };
      document.head.appendChild(s);
    }).catch(function (e) { embeddedPromise = null; throw e; });
    return embeddedPromise;
  }

  async function fromEmbedded(opt) {
    if (typeof global.__LUNA_ASSETS__ === 'undefined') {
      await loadEmbeddedScript();
    }
    var A = global.__LUNA_ASSETS__;
    return createEngine(
      A.wasm instanceof Uint8Array ? A.wasm : b64ToBytes(A.wasm),
      A.dict instanceof Uint8Array ? A.dict : b64ToBytes(A.dict),
      A.m3322 instanceof Uint8Array ? A.m3322 : b64ToBytes(A.m3322), opt);
  }

  /**
   * 装载默认中性引擎：
   *  - http(s) 静态站点：fetch 独立 wasm/词典/模型（可被浏览器/CDN 缓存）；
   *    任一文件失败/超时 → 动态加载 luna-assets.js 走 base64 内联兜底
   *  - file:// 直开：fetch 受限，页面已直接内联 luna-assets.js
   */
  async function loadDefault(opt) {
    opt = opt || {};
    var isHttp = typeof location !== 'undefined' &&
                 (location.protocol === 'http:' || location.protocol === 'https:');
    if (isHttp && !opt.embedded) {
      try {
        var base = opt.baseUrl || PLUGIN_BASE;
        var parts = await Promise.all([
          fetchBytes(assetUrl(ASSET_FILES.wasm, base)),
          fetchBytes(assetUrl(ASSET_FILES.dict, base)),
          fetchBytes(assetUrl(ASSET_FILES.model, base))
        ]);
        return await createEngine(parts[0], parts[1], parts[2], opt);
      } catch (e) {
        if (typeof opt.log === 'function') {
          opt.log('独立资产加载失败，回退内联包：' + (e && e.message));
        }
      }
    }
    return fromEmbedded(opt);
  }

  var Luna = {
    createEngine: createEngine,
    loadDefault: loadDefault,
    b64ToBytes: b64ToBytes,
    MKB2: MKB2,
    EOS_ID: EOS_ID,
    MAX_GEN: MAX_GEN
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Luna;
  global.Luna = Luna;
})(typeof globalThis !== 'undefined' ? globalThis : this);
