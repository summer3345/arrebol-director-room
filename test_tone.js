// v1.30.0 测试：基调仓。用户写下这局想玩什么，两位导演以它为第一要义压过角色卡。
// 桩子沿用 test_hotfix.js。跑法：npm install jsdom && SPEED=10 node test_tone.js
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
const SPEED = Number(process.env.SPEED || 1);
const tick = ms => new Promise(r => setTimeout(r, Math.max(1, Math.round(ms / SPEED))));
// 事件防抖 4.2s 会被 9s 轮询反复顺延，固定等几秒不可靠；条件满足就走，超时才判失败。
async function waitFor(fn, maxMs) {
    const t0 = Date.now(); const cap = Math.max(1, Math.round((maxMs || 30000) / SPEED));
    while (Date.now() - t0 < cap) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); }
    return !!fn();
}

function build(opts) {
    opts = opts || {};
    const dom = new JSDOM("<!doctype html><html><body></body></html>",
        { url: "https://example.org/", pretendToBeVisual: true, runScripts: "outside-only" });
    const win = dom.window; win.top = win;
    const chat = [], prompts = {}, extensionSettings = {}, chatMetadata = {}, handlers = {};
    if (opts.settings) extensionSettings[SET_KEY] = opts.settings;

    const calls = [], logs = [], redrawn = [], popups = [];
    let reloads = 0, saves = 0;
    let script = () => "1";
    let delayMs = 0;
    let failNext = false;

    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        const rec = { url, sys: body.messages[0].content, user: body.messages[1].content, body };
        calls.push(rec);
        if (delayMs) await tick(delayMs);
        if (failNext) throw new Error("mock API down");
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: script(calls.length, body) } }] })
        };
    };
    win.console = {
        log(...a) { logs.push(a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        warn(...a) { logs.push("W " + a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        error(...a) { logs.push("E " + a.map(x => String(x)).join(" ")); }, info() {}, debug() {}
    };
    if (opts.reloadCurrentChat !== false) win.reloadCurrentChat = () => { reloads++; };

    const context = {
        extensionSettings, chatMetadata, chat,
        chatId: "hotfix-test", getCurrentChatId: () => "hotfix-test",
        name1: opts.name1 || "江", name2: opts.name2 || "陆冀北",
        saveSettingsDebounced() {}, saveSettings() {},
        saveMetadataDebounced() {}, saveMetadata() {},
        saveChat: async () => { saves++; },
        setExtensionPrompt(k, v) { prompts[k] = { value: v }; },
        extensionPrompts: prompts,
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: s => s,
        eventSource: { on(t, f) { (handlers[t] = handlers[t] || []).push(f); } },
        event_types: { APP_READY: "app_ready", MESSAGE_RECEIVED: "message_received", GENERATION_STARTED: "generation_started", GENERATION_ENDED: "generation_ended", CHAT_CHANGED: "chat_changed" }
    };
    if (opts.updateMessageBlock !== false) context.updateMessageBlock = (i, m) => { redrawn.push(i); };

    // 数失败弹窗：data-kind 在 appendChild 之前就设好了
    const origAppend = win.document.body.appendChild.bind(win.document.body);
    win.document.body.appendChild = function (el) {
        try { if (el && el.id === "adr044-auto-trigger-popup") popups.push(el.getAttribute("data-kind") || "info"); } catch (e) {}
        return origAppend(el);
    };

    if (SPEED > 1) {
        const rT = win.setTimeout.bind(win), rI = win.setInterval.bind(win);
        win.setTimeout = (fn, ms, ...a) => rT(fn, Math.max(0, Math.round((ms || 0) / SPEED)), ...a);
        win.setInterval = (fn, ms, ...a) => rI(fn, Math.max(1, Math.round((ms || 0) / SPEED)), ...a);
    }
    win.eval(SRC);

    return {
        win, doc: win.document, context, prompts, calls, logs, redrawn, popups, chat,
        get reloads() { return reloads; }, get saves() { return saves; },
        setScript(f) { script = f; }, setDelay(ms) { delayMs = ms; }, setFail(v) { failNext = v; },
        st: () => extensionSettings[SET_KEY],
        meta: () => chatMetadata[META_KEY],
        addRound(userText, aiText) {
            chat.push({ is_user: true, mes: userText || "他把话说到一半就停住了。" });
            const mes = aiText || "<content>屋里安静下来，谁都没有先开口。</content>";
            chat.push({ is_user: false, name: "陆冀北", mes, swipe_id: 0, swipes: [mes] });
        },
        emit(t, ...args) { (handlers[t] || []).forEach(f => { try { f(...args); } catch (e) {} }); },
        killPoll() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); win.__arrebolDAutoTriggerPoll = null; } catch (e) {} },
        lastAi() { for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user) return chat[i]; return null; }
    };
}

function tapFast(win, el) {
    el.__adrDLastAcceptedTapAt = 0; el.__adrDLastTouchEndAt = 0; el.__adrDTapStart = null;
    el.dispatchEvent(new win.Event("click", { bubbles: true }));
}
function fire(win, el, type) { el.dispatchEvent(new win.Event(type, { bubbles: true })); }
const DIRECTOR = {
    masterEnabled: true, autoInjectEmotion: true, autoTriggerEmotion: true, autoTriggerEmotionRange: "custom", autoTriggerEmotionCustomRange: 2,
    autoInjectPlot: true, autoTriggerPlot: true, autoTriggerPlotRange: "custom", autoTriggerPlotCustomRange: 2,
    showAutoTriggerPopup: false, emotionApiEndpoint: "https://dir.example/v1", emotionApiKey: "k", emotionModel: "m",
    plotApiEndpoint: "https://dir.example/v1", plotApiKey: "k", plotModel: "m",
    cdEnabled: false
};
async function primeDirector(b, wantCalls) {
    b.emit("app_ready"); await tick(3000);
    b.addRound(); b.emit("message_received"); await tick(6000);   // 基准线
    b.addRound(); b.addRound(); b.emit("message_received");       // 到点
    await waitFor(() => b.calls.length >= (wantCalls || 1), 30000);
    await tick(1500);
}
const TONE = "这局就是想谈恋爱，卡里的血海深仇只当背景。";

(async () => {
    // ───────────────────────────────────────────────
    section("提示词 · 有基调时两位导演都吃到，且在最前");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.context.chatMetadata.arrebol_d = { v: 1, tone: { text: TONE, name: "甜甜恋爱", t: 1 } };
        b.setScript(() => "【情感方向】\n维持");
        await primeDirector(b, 2);
        ok(b.calls.length >= 2, "情感与统筹各触发了一次", "calls=" + b.calls.length);
        b.calls.slice(0, 2).forEach(c => {
            ok(c.user.indexOf("【用户基调 · 第一要义】") === 0, "采买清单第一段就是基调", c.user.slice(0, 30));
            ok(c.user.indexOf(TONE) >= 0, "基调正文原样在");
            ok(/所有方向以【用户基调】为第一优先/.test(c.user), "结尾指令点名基调优先");
            ok(/【硬性】.*【用户基调】.*第一要义/.test(c.sys), "系统消息也钉了一句", c.sys.slice(-80));
            ok(c.user.indexOf("【用户基调") < c.user.indexOf("【当前角色卡】") || c.user.indexOf("【当前角色卡】") < 0, "基调排在角色卡之前");
        });
        b.killPoll();
    }

    section("提示词 · 没基调时一个字不提");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.setScript(() => "【情感方向】\n维持");
        await primeDirector(b, 2);
        b.calls.slice(0, 2).forEach(c => {
            ok(c.user.indexOf("基调") < 0, "采买清单不提基调");
            ok(c.sys.indexOf("基调") < 0, "系统消息不提基调");
        });
        b.killPoll();
    }

    section("提示词 · 基调在一次性补充指令之前（长期的框 vs 临时插话）");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR, { autoTriggerPlot: false }) });
        b.context.chatMetadata.arrebol_d = { v: 1, tone: { text: TONE, name: "", t: 1 } };
        b.setScript(() => "【情感方向】\n维持");
        b.emit("app_ready"); await tick(3000);
        const extra = b.doc.querySelector("#adr044-emotion-extra");
        ok(!!extra, "找到补充指令框");
        if (extra) { extra.value = "这一拍先吵一架"; fire(b.win, extra, "input"); fire(b.win, extra, "change"); }
        b.addRound(); b.emit("message_received"); await tick(6000);
        b.addRound(); b.addRound(); b.emit("message_received");
        await waitFor(() => b.calls.length >= 1, 30000);
        const u = b.calls[0] ? b.calls[0].user : "";
        ok(u.indexOf("【用户基调") >= 0 && u.indexOf("一次性补充指令") >= 0, "两段都在");
        ok(u.indexOf("【用户基调") < u.indexOf("一次性补充指令"), "基调在补充指令之前");
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("面板 · 出厂八条就位，选一条即填入并存进这局");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.emit("app_ready"); await tick(3000);
        const sels = Array.from(b.doc.querySelectorAll("#adr044-tone-select"));
        ok(sels.length >= 1, "基调下拉在面板里", "n=" + sels.length);
        const names = Array.from(sels[0].options).map(o => o.value).filter(Boolean);
        ok(names.length === 8 && names.indexOf("两小无猜") >= 0 && names.indexOf("纯欲向") >= 0, "出厂八条都在", names.join("、"));
        ok(sels[0].value === "", "新聊天默认没选");
        const tas = Array.from(b.doc.querySelectorAll("#adr044-tone"));
        ok(tas.length >= 1 && tas.every(t => t.value === ""), "新聊天基调框是空的");
        sels[0].value = "搞笑沙雕"; fire(b.win, sels[0], "change"); await tick(200);
        const meta = () => b.context.chatMetadata.arrebol_d && b.context.chatMetadata.arrebol_d.tone;
        ok(meta() && meta().name === "搞笑沙雕" && meta().text === b.win.__adrDToneTest.factory["搞笑沙雕"], "选中即写进聊天文件", JSON.stringify(meta()));
        ok(tas.every(t => t.value === b.win.__adrDToneTest.factory["搞笑沙雕"]), "所有面板的基调框都填上了");
        ok(Array.from(b.doc.querySelectorAll("#adr044-tone-name")).every(n => n.value === "搞笑沙雕"), "名字框自动填");
        ok(/搞笑沙雕/.test(b.doc.querySelector("#adr044-tone-status").textContent), "状态行说明已填入");
        ok(b.win.__adrDToneTest.block().indexOf(b.win.__adrDToneTest.factory["搞笑沙雕"]) >= 0, "提示词段立刻能取到");
        b.killPoll();
    }

    section("面板 · 自己改字随手存；存进仓；删仓不复活；清空");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.emit("app_ready"); await tick(3000);
        const ta = b.doc.querySelector("#adr044-tone");
        const nameEl = b.doc.querySelector("#adr044-tone-name");
        const meta = () => b.context.chatMetadata.arrebol_d && b.context.chatMetadata.arrebol_d.tone;
        ta.value = "这局想玩轻松校园"; fire(b.win, ta, "input"); await tick(100);
        ok(meta() && meta().text === "这局想玩轻松校园", "打字即存进这局", JSON.stringify(meta()));
        ok(b.win.__adrDToneTest.text() === "这局想玩轻松校园", "导演读到的就是刚打的字");
        // 存仓：先不起名
        tapFast(b.win, b.doc.querySelector("#adr044-tone-save")); await tick(100);
        ok(/起个名/.test(b.doc.querySelector("#adr044-tone-status").textContent), "没起名不给存，状态行提示");
        nameEl.value = "我的校园"; fire(b.win, nameEl, "change");
        tapFast(b.win, b.doc.querySelector("#adr044-tone-save")); await tick(300);
        const st = b.st();
        ok(st.toneStore && st.toneStore["我的校园"] === "这局想玩轻松校园", "存进基调仓", JSON.stringify(st.toneStore && Object.keys(st.toneStore)));
        ok(Array.from(b.doc.querySelector("#adr044-tone-select").options).some(o => o.value === "我的校园"), "下拉里立刻有它");
        ok(b.doc.querySelector("#adr044-tone-select").value === "我的校园", "下拉选中它");
        // 删仓：删出厂条目
        const sel = b.doc.querySelector("#adr044-tone-select");
        sel.value = "轻松日常"; fire(b.win, sel, "change"); await tick(200);
        ok(meta() && meta().name === "轻松日常", "先选中出厂条目");
        tapFast(b.win, b.doc.querySelector("#adr044-tone-delete")); await tick(300);
        ok(!("轻松日常" in b.st().toneStore), "从仓里删掉了");
        ok(meta() && meta().text === b.win.__adrDToneTest.factory["轻松日常"], "这局的文字还在（删的是仓不是这局）", JSON.stringify(meta()));
        ok(!("轻松日常" in b.win.__adrDToneTest.store()), "再读仓也不复活（toneSeeded 记账）");
        ok(Array.isArray(b.st().toneSeeded) && b.st().toneSeeded.indexOf("轻松日常") >= 0, "记账里有它");
        // 清空
        tapFast(b.win, b.doc.querySelector("#adr044-tone-clear")); await tick(200);
        ok(!meta(), "清空后聊天文件里没有基调", JSON.stringify(meta()));
        ok(ta.value === "" && b.win.__adrDToneTest.block() === "", "框空了，提示词段也空了");
        b.killPoll();
    }

    section("面板 · 按聊天各记各的：换聊天回填");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.context.chatMetadata.arrebol_d = { v: 1, tone: { text: "聊天甲：家国大义", name: "家国大义", t: 1 } };
        b.emit("app_ready"); await tick(3000);
        const ta = b.doc.querySelector("#adr044-tone");
        ok(ta.value === "聊天甲：家国大义", "打开面板就是这局的基调", ta.value);
        // 换到另一把聊天：酒馆会换掉 chatMetadata 对象，然后广播 CHAT_CHANGED
        b.context.chatMetadata = { arrebol_d: { v: 1, tone: { text: "聊天乙：纯欲", name: "纯欲向", t: 2 } } };
        b.emit("chat_changed"); await tick(1500);
        ok(ta.value === "聊天乙：纯欲", "换聊天后框里换成那局的", ta.value);
        ok(b.doc.querySelector("#adr044-tone-select").value === "纯欲向", "下拉跟着换");
        b.context.chatMetadata = {};
        b.emit("chat_changed"); await tick(1500);
        ok(ta.value === "" && b.doc.querySelector("#adr044-tone-select").value === "", "换到没设过基调的聊天就是空的");
        b.killPoll();
    }

    console.log("\n════════════════════════════════");
    console.log("通过 " + PASS + " · 失败 " + FAIL);
    if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
    console.log("════════════════════════════════");
    process.exit(FAIL ? 1 : 0);
})();
