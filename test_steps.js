// v1.34.0 测试：剧情展开推进（导演椅）。投卡时把卡切成 N 幕、一回合只贴一幕、回复位推进、走完结案。
// 桩子沿用 test_pick.js，另加：展开 API 单独路由、setExtensionPrompt 记录 depth。跑法：npm install jsdom && SPEED=10 node test_steps.js
const fs = require("fs");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync("index.js", "utf8");
const SET_KEY = "arrebol-d-final-v1040-stable-settings";
const META_KEY = "arrebol_d_cd";

let PASS = 0, FAIL = 0; const failures = [];
function ok(c, name, extra) {
    if (c) { PASS++; console.log("  ✓ " + name); }
    else { FAIL++; failures.push(name); console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function section(t) { console.log("\n── " + t + " ──"); }
// 时间加速：插件的事件防抖是 4.2s，逐楼真等会让整套跑好几分钟。
// 这里只压缩测试环境的定时器，插件代码一字不改；楼层节奏由事件驱动，与真实时长无关。
const SPEED = Number(process.env.SPEED || 1);
const tick = ms => new Promise(r => setTimeout(r, Math.max(1, Math.round(ms / SPEED))));

function build(opts) {
    opts = opts || {};
    const dom = new JSDOM("<!doctype html><html><body></body></html>",
        { url: "https://example.org/", pretendToBeVisual: true, runScripts: "outside-only" });
    const win = dom.window; win.top = win;
    const chat = [], prompts = {}, extensionSettings = {}, chatMetadata = {}, handlers = {};
    if (opts.settings) extensionSettings[SET_KEY] = opts.settings;

    const calls = [];                 // 每次发给 DS 的请求
    const xcalls = [];                // 每次发给展开 API 的请求
    let script = () => "";            // DS 这次答什么
    let xscript = () => "";           // 展开 API 这次答什么
    let failNext = false;             // 让 DS 这次直接挂掉
    let xfail = false;                // 让展开 API 这次直接挂掉
    const injections = [];            // setExtensionPrompt 的每次调用 {value, depth}

    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        if (String(url).indexOf("expand.example") >= 0) {
            xcalls.push({ url, sys: body.messages[0].content, user: body.messages[1] ? body.messages[1].content : "", body });
            if (xfail) throw new Error("mock expand down");
            const xa = xscript(xcalls.length, body);
            return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: xa } }] }) };
        }
        calls.push({ url, sys: body.messages[0].content, user: body.messages[1].content, body });
        if (failNext) throw new Error("mock DS down");
        const answer = script(calls.length, body);
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: answer } }] })
        };
    };
    const draws = [], logs = [];
    win.console = {
        log(...a) { logs.push(String(a[0] || "")); if (String(a[0] || "").indexOf("投卡") >= 0 && a[1]) draws.push(a[1]); },
        warn(...a) { logs.push(a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        error() {}, info() {}, debug() {}
    };

    const context = {
        extensionSettings, chatMetadata, chat,
        chatId: "pick-test", getCurrentChatId: () => "pick-test",
        saveSettingsDebounced() {}, saveSettings() {},
        saveMetadataDebounced() {}, saveMetadata() {},
        setExtensionPrompt(k, v, pos, depth) { prompts[k] = { value: v }; injections.push({ key: k, value: String(v || ""), depth: depth }); },
        extensionPrompts: prompts,
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: s => s,
        eventSource: { on(t, f) { (handlers[t] = handlers[t] || []).push(f); } },
        event_types: { APP_READY: "app_ready", MESSAGE_RECEIVED: "message_received", MESSAGE_SENT: "message_sent", CHAT_CHANGED: "chat_changed" }
    };
    if (SPEED > 1) {
        const rT = win.setTimeout.bind(win), rI = win.setInterval.bind(win);
        win.setTimeout = (fn, ms, ...a) => rT(fn, Math.max(0, Math.round((ms || 0) / SPEED)), ...a);
        win.setInterval = (fn, ms, ...a) => rI(fn, Math.max(1, Math.round((ms || 0) / SPEED)), ...a);
    }
    try { win.localStorage.clear(); } catch (e) {}   // jsdom 的 localStorage 按域名跨窗口共享，上一段的聊天镜像会漏进来
    win.eval(SRC);

    return {
        win, doc: win.document, context, prompts, calls, xcalls, draws, logs, injections,
        setScript(f) { script = f; },
        setXScript(f) { xscript = f; },
        setFail(v) { failNext = v; },
        setXFail(v) { xfail = v; },
        st: () => extensionSettings[SET_KEY],
        meta: () => chatMetadata[META_KEY],
        float: () => (prompts["ARREBOL_D_CARD_DRAWER"] ? String(prompts["ARREBOL_D_CARD_DRAWER"].value || "") : ""),
        addRound() {
            chat.push({ is_user: true, mes: "用户回了一句。" });
            chat.push({ is_user: false, mes: "<content>第 " + (chat.length + 1) + " 段正文。</content>" });
        },
        emit(t) { (handlers[t] || []).forEach(f => { try { f(); } catch (e) {} }); },
        killPoll() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); win.__arrebolDAutoTriggerPoll = null; } catch (e) {} },
        stop() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); } catch (e) {} dom.window.close(); }
    };
}
function tapFast(win, el) {
    el.__adrDLastAcceptedTapAt = 0; el.__adrDLastTouchEndAt = 0; el.__adrDTapStart = null;
    el.dispatchEvent(new win.Event("click", { bubbles: true }));
}
function setCheck(win, el, v) {
    el.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
    el.checked = v; el.dispatchEvent(new win.Event("change", { bubbles: true }));
}
function setSelect(win, el, v) {
    el.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
    el.value = v; el.dispatchEvent(new win.Event("change", { bubbles: true }));
}
function setInput(win, el, v) {
    el.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
    el.value = v;
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
}

// 三格建库 + 开择池 + 填好假 API
async function bootPick(opts) {
    opts = opts || {};
    const e = build({ settings: { supplementMemory: "调性设定：" + "情欲描写".repeat(1200) } });
    e.win.document.dispatchEvent(new e.win.Event("DOMContentLoaded"));
    await tick(2400);
    e.killPoll();
    const d = e.doc;

    const libs = [["专属卡库", "## 甲\nS1\nS2\nS3\nS4\nS5", "story"],
                  ["通用卡库", "## 乙\nC1\nC2\nC3\nC4\nC5", "common"]];
    if (opts.nsfw !== false) libs.push(["情欲卡库", "## 丙\nN1\nN2\nN3\nN4\nN5", "nsfw"]);
    for (const [name, text, slot] of libs) {
        setSelect(e.win, d.querySelector("#adr044-cd-import-slot"), slot);
        await tick(30);
        d.querySelector("#adr044-cd-lib-name").value = name;
        d.querySelector("#adr044-cd-lib-editor").value = text;
        tapFast(e.win, d.querySelector("#adr044-cd-lib-save"));
        await tick(120);
    }
    const stock = d.querySelector('#adr044-cd-slot-common [data-adrcd-lib="通用"]');
    if (stock && stock.classList.contains("on")) { tapFast(e.win, stock); await tick(1700); }
    ["story", "common"].forEach(s => setCheck(e.win, d.querySelector("#adr044-cd-slot-on-" + s), true));
    setCheck(e.win, d.querySelector("#adr044-cd-slot-on-nsfw"), opts.nsfw !== false);

    setInput(e.win, d.querySelector("#adr044-cd-endpoint"), "https://ds.example.org/v1/chat/completions");
    setInput(e.win, d.querySelector("#adr044-cd-model"), "deepseek-chat");
    setSelect(e.win, d.querySelector("#adr044-cd-mode"), opts.mode || "pick");
    setCheck(e.win, d.querySelector("#adr044-cd-enabled"), true);
    setInput(e.win, d.querySelector("#adr044-cd-n"), String(opts.n || 1));
    await tick(150);
    return e;
}
async function beat(e) { e.addRound(); e.emit("message_received"); await tick(4600); }
const T = e => e.win.__adrCdExpandTest;
const STEPS5 = ["山脚集合", "采摘野莓", "写生", "突降大雨", "山洞避雨"];
function planJson(names, prefix) {
    return JSON.stringify({ steps: names.map((n, i) => ({ name: n, text: (prefix || "第" + (i + 1) + "幕正文：") + n + "，地点动作细节一句话。" })) });
}
const PLAN = "【分析】\n这段戏场地在山里，两个人关系微妙 {这里有个花括号} 节奏要慢起快落。\n【步骤】\n" + planJson(STEPS5);
function enableExpand(e, extra) {
    // 走面板控件存，不直接改裸对象——插件的 settings() 有自己的一份合并缓存，裸改看不见。
    const d = e.doc; extra = extra || {};
    setCheck(e.win, d.querySelector("#adr044-cd-expand-enabled"), true);
    setInput(e.win, d.querySelector("#adr044-expand-endpoint"), "https://expand.example/v1");
    setInput(e.win, d.querySelector("#adr044-expand-model"), "big");
    setInput(e.win, d.querySelector("#adr044-cd-expand-n"), "5");
    if (extra.cdExpandPer) setInput(e.win, d.querySelector("#adr044-cd-expand-per"), String(extra.cdExpandPer));
    if (extra.cdExpandNsfw) setCheck(e.win, d.querySelector("#adr044-cd-expand-nsfw"), true);
}
async function bootExpand(opts) {
    opts = opts || {};
    // 默认不挂 NSFW 格：NSFW 卡默认不展开，混在盲抽里会让断言时灵时不灵
    const e = await bootPick(Object.assign({ n: 1, mode: "blind", nsfw: false }, opts));
    enableExpand(e, opts.extra);
    await tick(200);
    e.setXScript(() => PLAN);
    await beat(e);   // 第一拍只对齐基准线，下一拍才投卡
    return e;
}
async function waitFor(fn, maxMs) {
    const t0 = Date.now(); const cap = Math.max(1, Math.round((maxMs || 30000) / SPEED));
    while (Date.now() - t0 < cap) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); }
    return !!fn();
}
// 投卡拍：等到真投出来（展开是异步的，固定等几百毫秒不可靠）
async function drawBeat(e) { const before = e.draws.length; e.addRound(); e.emit("message_received"); await waitFor(() => e.draws.length > before, 30000); await tick(600); }
function lastInj(e) { const arr = e.injections.filter(x => x.key === "ARREBOL_D_CARD_DRAWER"); return arr[arr.length - 1] || null; }
function ex(e) { return e.meta() && e.meta().expand; }
async function say(e) { e.emit("message_sent"); await tick(300); }
async function reply(e) { e.emit("message_received"); await tick(300); }
function fire(win, el, type) { el.dispatchEvent(new win.Event(type, { bubbles: true })); }
function tapId(e, id) { const el = e.doc.querySelector("#" + id); tapFast(e.win, el); }

(async () => {
    section("解析 · 十种形状");
    {
        const e = build({});
        const P = T(e).parse;
        let r = P(PLAN, 5);
        ok(r.steps.length === 5 && r.steps[3].name === "突降大雨", "分析段带花括号也不被带偏，切出 5 幕", r.steps.map(s => s.name).join("/"));
        ok(r.analysis.indexOf("节奏要慢起快落") >= 0 && r.analysis.indexOf("【分析】") < 0, "分析段留档且去掉标签", r.analysis.slice(0, 40));
        ok(r.warnings.length === 0, "刚好 5 幕不警告");
        r = P("```json\n" + planJson(STEPS5) + "\n```", 5);
        ok(r.steps.length === 5, "代码块包着也能解");
        r = P(planJson(STEPS5.concat(["下山", "回家"])), 5);
        ok(r.steps.length === 5 && /多给/.test(r.warnings[0]), "多给截到 5 并警告", r.warnings.join(";"));
        r = P(planJson(STEPS5.slice(0, 3)), 5);
        ok(r.steps.length === 3 && /只给了 3/.test(r.warnings[0]), "少给照收并警告");
        r = P(JSON.stringify({ steps: ["甲", "乙"] }), 2);
        ok(r.steps.length === 2 && r.steps[0].text === "甲" && r.steps[0].name === "第 1 幕", "字符串数组也认，名字自动编号");
        let threw = false; try { P("我不知道怎么切", 5); } catch (err) { threw = /没有可解析/.test(err.message); }
        ok(threw, "胡话抛错");
        threw = false; try { P(JSON.stringify({ steps: [] }), 5); } catch (err) { threw = /一幕都没/.test(err.message); }
        ok(threw, "空数组抛错");
        threw = false; try { P(JSON.stringify({ foo: 1 }), 5); } catch (err) { threw = true; }
        ok(threw, "没有 steps 键抛错");
        const st = { steps: r.steps.length ? r.steps : [{ name: "甲", text: "甲文" }, { name: "乙", text: "乙文" }] };
        const t0 = T(e).stepText({ steps: [{ name: "甲", text: "甲文" }, { name: "乙", text: "乙文" }] }, 0);
        const t1 = T(e).stepText({ steps: [{ name: "甲", text: "甲文" }, { name: "乙", text: "乙文" }] }, 1);
        ok(/第 1\/2 幕/.test(t0) && t0.indexOf("甲文") >= 0 && t0.indexOf("乙文") < 0 && t0.indexOf("上一幕") < 0, "第一幕正文只含本幕，不提上一幕");
        ok(/第 2\/2 幕/.test(t1) && t1.indexOf("上一幕已经演过：甲") >= 0 && t1.indexOf("甲文") < 0, "第二幕只带上一幕的名字，不带正文");
        ok(t0.indexOf(T(e).trailer) >= 0 && /只演到这一幕为止/.test(t0), "贴耳语在末尾");
        e.stop();
    }

    section("投卡展开 · 第一幕贴上，depth 0，后面的幕不在上下文里");
    {
        const e = await bootExpand();
        await drawBeat(e);
        ok(e.draws.length === 1, "投了一张", "draws=" + e.draws.length);
        ok(e.xcalls.length === 1, "展开 API 被调了一次", "x=" + e.xcalls.length);
        const u = e.xcalls[0].user;
        ok(u.indexOf("【抽到的事件卡") >= 0 && /严格 5 幕/.test(u) && u.indexOf("【最近正文 · 此刻】") >= 0, "展开请求带卡面、幕数、最近正文");
        ok(/紧扣角色卡/.test(e.xcalls[0].sys) && /先分析，再切幕/.test(e.xcalls[0].sys), "出厂提示词：先分析再切幕、紧扣角色卡");
        ok(/只给事件，不给反应/.test(e.xcalls[0].sys) && /不写「两人抱在一起」/.test(e.xcalls[0].sys) && /他此刻并不知道/.test(e.xcalls[0].sys), "出厂提示词：只给外部事件，不预设两人反应");
        ok(e.xcalls[0].sys.indexOf("一句能说出口的话") < 0, "不再要求写台词");
        ok(/事件卡是脊柱/.test(e.xcalls[0].sys) && /不搞超自然、不搞玄乎、不神神叨叨、不堆巧合/.test(e.xcalls[0].sys) && /不引入新的重要人物/.test(e.xcalls[0].sys), "言情责编取向：卡是脊柱、合情理、不加新人");
        ok(u.indexOf("【最近正文 · 此刻】") < u.indexOf("【角色卡 / 世界书") || u.indexOf("【角色卡 / 世界书") < 0, "此刻在前、角色卡在后");
        ok(e.xcalls[0].body.temperature === 0.5, "温度 0.5");
        ok(/不给反应/.test(T(e).trailer) && /用户那一侧留给用户/.test(T(e).trailer), "贴耳语也只给事件、反应留给两个人");
        const x = ex(e);
        ok(x && x.on && x.cursor === 0 && x.steps.length === 5, "账本：展开中，第一幕", JSON.stringify(x && { on: x.on, cursor: x.cursor, n: x.steps.length }));
        const inj = lastInj(e);
        ok(inj && inj.depth === 0, "贴耳固定 depth 0（不读注入深度 2）", JSON.stringify(inj && inj.depth));
        ok(inj.value.indexOf("第1幕正文") >= 0 && inj.value.indexOf("第2幕正文") < 0 && inj.value.indexOf("只演到这一幕为止") >= 0, "耳边只有第一幕加贴耳语");
        ok(/展开 5 幕/.test(String(e.draws[0]["模式"])), "投卡史记了展开", e.draws[0]["模式"]);
        const line = e.doc.querySelector("#adr044-cd-status-line");
        ok(line && /展开推进中 第 1\/5 幕/.test(line.textContent), "状态行显示第 1/5 幕", line && line.textContent);
        ok(/▶ 第 1 幕/.test(e.doc.querySelector("#adr044-cd-expand-panel").textContent), "耳边面板列出分幕并标出当前");
        e.stop();
    }

    section("推进 · 回复位：落地记用过，再发言才翻页，重抽不多算，连发不吞");
    {
        const e = await bootExpand();
        await drawBeat(e);
        ok(ex(e) && ex(e).cursor === 0 && !ex(e).used, "起点：第一幕，未用过");
        await say(e);
        ok(ex(e).cursor === 0, "没回复就发言：不翻页（连发不吞）");
        await reply(e);
        ok(ex(e).used === true, "回复落地：记为用过");
        await reply(e);
        ok(ex(e).cursor === 0 && ex(e).used === true, "重抽再落地：仍是第一幕、仍只算一次");
        await say(e);
        ok(ex(e).cursor === 1 && !ex(e).used, "再发言：翻到第二幕", "cursor=" + ex(e).cursor);
        const inj = lastInj(e);
        ok(inj.depth === 0 && inj.value.indexOf("第2幕正文") >= 0 && inj.value.indexOf("上一幕已经演过：山脚集合") >= 0 && inj.value.indexOf("第1幕正文") < 0, "耳边换成第二幕，只带上一幕名字");
        // 跑线期间不投新卡
        const before = e.draws.length;
        for (let i = 0; i < 3; i++) { e.addRound(); e.emit("message_received"); await tick(4600); }
        ok(e.draws.length === before && e.xcalls.length === 1, "跑线期间 N 楼到点也不投新卡", "draws=" + e.draws.length);
        // 走完
        for (let i = 0; i < 10 && ex(e).on; i++) { await reply(e); await say(e); }
        const x = ex(e);
        ok(x && !x.on && x.finished, "五幕演完自动撤下", JSON.stringify({ on: x.on, finished: x.finished, cursor: x.cursor }));
        ok(e.meta().floatStage === "done" && e.float() === "", "结案：耳边清空");
        ok(e.meta().history.slice(-1)[0].status === "done", "投卡史记为已兑现");
        ok(e.meta().lastDrawAt === Math.floor(e.context.chat.length / 2), "基准线移到当前楼，下一张按 N 起算", "lastDrawAt=" + e.meta().lastDrawAt + " floors=" + e.context.chat.length / 2);
        await drawBeat(e);
        ok(e.draws.length === before + 1 && e.xcalls.length === 2, "线走完后到点照常投下一张并展开");
        e.stop();
    }

    section("推进 · 每幕演两轮");
    {
        const e = await bootExpand({ extra: { cdExpandPer: 2 } });
        await drawBeat(e);
        ok(ex(e).per === 2, "账本记了每幕 2 轮");
        await reply(e); await say(e);
        ok(ex(e).cursor === 0 && ex(e).served === 1, "演一轮还在第一幕", "served=" + ex(e).served);
        await reply(e); await say(e);
        ok(ex(e).cursor === 1, "演满两轮翻页");
        e.stop();
    }

    section("手动 · 下一幕 / 上一幕 / 撤下这条线");
    {
        const e = await bootExpand();
        await drawBeat(e);
        tapId(e, "adr044-cd-expand-next"); await tick(200);
        ok(ex(e).cursor === 1, "下一幕");
        tapId(e, "adr044-cd-expand-prev"); await tick(200);
        ok(ex(e).cursor === 0 && lastInj(e).value.indexOf("第1幕正文") >= 0, "上一幕回到第一幕并重贴");
        tapId(e, "adr044-cd-expand-stop"); await tick(200);
        ok(!ex(e).on && e.float() === "" && e.meta().floatStage === "done", "撤下这条线：结案清空");
        e.stop();
    }

    section("手动结案与暂停");
    {
        const e = await bootExpand();
        await drawBeat(e);
        setCheck(e.win, e.doc.querySelector("#adr044-cd-paused"), true); await tick(200);
        ok(e.float() === "", "暂停：耳边清空");
        setCheck(e.win, e.doc.querySelector("#adr044-cd-paused"), false); await tick(200);
        ok(e.float().indexOf("第1幕正文") >= 0 && lastInj(e).depth === 0, "恢复：第一幕重贴，仍是 depth 0");
        tapId(e, "adr044-cd-close-card"); await tick(200);
        ok(!ex(e).on && ex(e).finished && e.float() === "", "「这张已兑现」也撤下分幕");
        e.stop();
    }

    section("换聊天恢复 · 重贴当前幕");
    {
        const e = await bootExpand();
        await drawBeat(e);
        await reply(e); await say(e);
        const n0 = e.injections.length;
        e.emit("chat_changed"); await tick(1500);
        const inj = lastInj(e);
        ok(e.injections.length > n0 && inj.depth === 0 && inj.value.indexOf("第2幕正文") >= 0, "换聊天回来重贴的是第二幕、depth 0");
        e.stop();
    }

    section("回退 · 展开失败按整张卡投；NSFW 默认不展开");
    {
        const e = await bootExpand();
        e.setXFail(true);
        await beat(e);
        ok(e.draws.length === 1 && e.xcalls.length === 1, "展开挂了照样投卡");
        ok(!ex(e) && e.float().indexOf("只演到这一幕为止") < 0 && e.float().length > 0, "耳边是整张卡的信封，不是分幕");
        ok(/展开失败/.test(e.doc.querySelector("#adr044-cd-life-status").textContent), "状态行说明展开失败");
        e.stop();

        const e2 = await bootExpand({ nsfw: true });
        ["story", "common"].forEach(s => setCheck(e2.win, e2.doc.querySelector("#adr044-cd-slot-on-" + s), false));
        setCheck(e2.win, e2.doc.querySelector("#adr044-cd-slot-on-nsfw"), true); await tick(150);
        await drawBeat(e2);
        ok(e2.draws.length === 1 && e2.xcalls.length === 0 && !ex(e2), "NSFW 卡不发给展开 API，按整张投", "x=" + e2.xcalls.length);
        e2.stop();

        const e3 = await bootExpand({ nsfw: true, extra: { cdExpandNsfw: true } });
        ["story", "common"].forEach(s => setCheck(e3.win, e3.doc.querySelector("#adr044-cd-slot-on-" + s), false));
        setCheck(e3.win, e3.doc.querySelector("#adr044-cd-slot-on-nsfw"), true); await tick(150);
        await drawBeat(e3);
        ok(e3.xcalls.length === 1 && ex(e3) && ex(e3).on, "勾了「NSFW 也展开」才展开");
        e3.stop();
    }

    section("统筹视野 · 投卡史里带分幕，只标当前幕正文");
    {
        const e = await bootExpand();
        await drawBeat(e); await reply(e); await say(e);
        const blk = T(e).historyBlock(e.meta());
        ok(/切成 5 幕/.test(blk) && /现在演到第 2 幕/.test(blk), "说明切成几幕、演到第几幕");
        ok(blk.indexOf("第2幕正文") >= 0 && blk.indexOf("第3幕正文") < 0 && /「山洞避雨」（还没演）/.test(blk), "只给当前幕正文，后面的幕只给名字");
        ok(/不要把后面的幕透给演员/.test(blk), "叮嘱统筹别泄底");
        e.stop();
    }

    section("面板 · 开关与字段就位、改动即存");
    {
        const e = await bootPick({ n: 1, mode: "blind" });
        const d = e.doc;
        ok(!!d.querySelector("#adr044-cd-expand-enabled") && !!d.querySelector("#adr044-expand-endpoint") && !!d.querySelector("#adr044-expand-preset"), "展开抽屉里开关、API、提示词都在");
        ok(!d.querySelector("#adr044-cd-expand-enabled").checked, "默认关");
        setCheck(e.win, d.querySelector("#adr044-cd-expand-enabled"), true); await tick(200);
        ok(e.st().cdExpandEnabled === true, "勾选即存");
        setInput(e.win, d.querySelector("#adr044-cd-expand-n"), "40"); await tick(200);
        ok(e.st().cdExpandN === 12 && d.querySelector("#adr044-cd-expand-n").value === "12", "幕数越界存 12 并回显封顶", e.st().cdExpandN + "/" + d.querySelector("#adr044-cd-expand-n").value);
        setInput(e.win, d.querySelector("#adr044-expand-endpoint"), "https://expand.example/v1"); await tick(200);
        ok(e.st().expandApiEndpoint === "https://expand.example/v1", "展开 API 地址存入独立字段");
        ok(!e.st().cdApiEndpoint || e.st().cdApiEndpoint.indexOf("expand.example") < 0, "不串到小眼睛的 API 位");
        e.stop();
    }

    section("面板 · 分幕露出来能改：改当前幕立刻重贴，改别的只存，删、调序、追加、重新展开");
    {
        const e = await bootExpand();
        await drawBeat(e);
        const d = e.doc;
        const rows = () => Array.from(d.querySelectorAll("#adr044-cd-expand-panel .adr044-cd-step"));
        ok(rows().length === 5 && rows()[0].classList.contains("on"), "五幕各一行，当前幕高亮", "rows=" + rows().length);
        ok(d.querySelectorAll("#adr044-cd-expand-panel .adr044-cd-step-text").length === 5, "每幕一个可编辑正文框");
        // 改当前幕
        const ta0 = d.querySelector("#adr044-cd-expand-panel .adr044-cd-step-text[data-idx=\"0\"]");
        ta0.value = "改过的第一幕：雨突然下大了，山道上只有一个岩缝。"; fire(e.win, ta0, "input"); fire(e.win, ta0, "change"); await tick(200);
        ok(ex(e).steps[0].text.indexOf("改过的第一幕") === 0, "账本里第一幕改了");
        ok(lastInj(e).value.indexOf("改过的第一幕") >= 0 && lastInj(e).depth === 0, "正贴着的那一幕改了字立刻重贴");
        // 改别的幕
        const nInj = e.injections.length;
        const ta2 = d.querySelector("#adr044-cd-expand-panel .adr044-cd-step-text[data-idx=\"2\"]");
        ta2.value = "改过的第三幕"; fire(e.win, ta2, "input"); fire(e.win, ta2, "change"); await tick(200);
        ok(ex(e).steps[2].text === "改过的第三幕" && e.injections.length === nInj, "改别的幕只存不重贴");
        const nm = d.querySelector("#adr044-cd-expand-panel .adr044-cd-step-name[data-idx=\"2\"]");
        nm.value = "山雨"; fire(e.win, nm, "change"); await tick(200);
        ok(ex(e).steps[2].name === "山雨", "小标题也能改");
        // 下移当前幕：它的正文跟着走，光标跟着走，耳边序号变
        const btn = act => d.querySelector("#adr044-cd-expand-panel .adr044-cd-step-btn[data-act=\"" + act + "\"][data-idx=\"0\"]");
        btn("down").dispatchEvent(new e.win.MouseEvent("click", { bubbles: true })); await tick(200);
        ok(ex(e).cursor === 1 && ex(e).steps[1].text.indexOf("改过的第一幕") === 0 && ex(e).steps[0].name === "采摘野莓", "当前幕下移：光标跟着正文走");
        ok(/第 2\/5 幕/.test(lastInj(e).value) && lastInj(e).value.indexOf("改过的第一幕") >= 0, "耳边序号跟着变成第 2 幕");
        // 删掉第 1 幕（在当前幕之前）：光标前移
        d.querySelector("#adr044-cd-expand-panel .adr044-cd-step-btn[data-act=\"del\"][data-idx=\"0\"]").dispatchEvent(new e.win.MouseEvent("click", { bubbles: true })); await tick(200);
        ok(ex(e).steps.length === 4 && ex(e).cursor === 0 && ex(e).steps[0].text.indexOf("改过的第一幕") === 0, "删当前幕之前的一幕：共 4 幕，光标前移仍指同一幕");
        // 追加
        d.querySelector("#adr044-cd-expand-panel .adr044-cd-step-btn[data-act=\"add\"]").dispatchEvent(new e.win.MouseEvent("click", { bubbles: true })); await tick(200);
        ok(ex(e).steps.length === 5 && /改我/.test(ex(e).steps[4].text), "追加一幕带占位正文");
        // 删到只剩一幕时拦下
        for (let i = 0; i < 4; i++) { const b = d.querySelector("#adr044-cd-expand-panel .adr044-cd-step-btn[data-act=\"del\"][data-idx=\"1\"]"); if (b) { b.dispatchEvent(new e.win.MouseEvent("click", { bubbles: true })); await tick(120); } }
        ok(ex(e).steps.length === 1, "删到只剩一幕");
        d.querySelector("#adr044-cd-expand-panel .adr044-cd-step-btn[data-act=\"del\"][data-idx=\"0\"]").dispatchEvent(new e.win.MouseEvent("click", { bubbles: true })); await tick(120);
        ok(ex(e).steps.length === 1 && /至少留一幕/.test(d.querySelector("#adr044-cd-life-status").textContent), "最后一幕删不掉，状态行提示");
        // 重新展开
        const xBefore = e.xcalls.length;
        e.setXScript(() => "【分析】\n重来一遍。\n【步骤】\n" + planJson(["甲", "乙", "丙"], "重展第"));
        d.querySelector("#adr044-cd-expand-panel .adr044-cd-step-btn[data-act=\"replan\"]").dispatchEvent(new e.win.MouseEvent("click", { bubbles: true }));
        await waitFor(() => e.xcalls.length > xBefore && ex(e) && ex(e).steps.length === 3, 30000); await tick(200);
        ok(e.xcalls.length === xBefore + 1 && ex(e).steps.length === 3 && ex(e).cursor === 0 && ex(e).on, "重新展开：又调了一次展开 API，换成 3 幕从头贴");
        ok(lastInj(e).value.indexOf("重展第甲") >= 0 && /第 1\/3 幕/.test(lastInj(e).value), "耳边是新的第一幕");
        ok(/重来一遍/.test(d.querySelector("#adr044-cd-expand-panel").textContent), "面板里能看到导演的分析");
        e.stop();
    }

    console.log("\n════════════════════════════════");
    console.log("通过 " + PASS + " · 失败 " + FAIL);
    if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
    console.log("════════════════════════════════");
    process.exit(FAIL ? 1 : 0);
})();
