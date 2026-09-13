// v1.27.2 测试：NSFW 库投不出。用户反馈「NSFW 完全不触发，单独打开也不触发」。
// 复现：择池／择卡下小眼睛一失败（审核打回、答复无效）NSFW 就被硬闸排除，只开 NSFW 时永远空过；
// 三格全开时审核恰在情欲场面打回，也就是本该开门的时候，于是一张都投不出。
// 桩子沿用 test_pick.js。跑法：npm install jsdom && SPEED=10 node test_nsfw.js
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
    let script = () => "";            // DS 这次答什么
    let failNext = false;             // 让 DS 这次直接挂掉

    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
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
        setExtensionPrompt(k, v) { prompts[k] = { value: v }; },
        extensionPrompts: prompts,
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: s => s,
        eventSource: { on(t, f) { (handlers[t] = handlers[t] || []).push(f); } },
        event_types: { APP_READY: "app_ready", MESSAGE_RECEIVED: "message_received" }
    };
    if (SPEED > 1) {
        const rT = win.setTimeout.bind(win), rI = win.setInterval.bind(win);
        win.setTimeout = (fn, ms, ...a) => rT(fn, Math.max(0, Math.round((ms || 0) / SPEED)), ...a);
        win.setInterval = (fn, ms, ...a) => rI(fn, Math.max(1, Math.round((ms || 0) / SPEED)), ...a);
    }
    win.eval(SRC);

    return {
        win, doc: win.document, context, prompts, calls, draws, logs,
        setScript(f) { script = f; },
        setFail(v) { failNext = v; },
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
const MOD400 = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "Content Exists Risk", type: "invalid_request_error" } }) });
async function nsfwOnly(e) {
    const d = e.doc;
    ["story", "common"].forEach(s => setCheck(e.win, d.querySelector("#adr044-cd-slot-on-" + s), false));
    setCheck(e.win, d.querySelector("#adr044-cd-slot-on-nsfw"), true);
    await tick(150);
}
// 再挂一副两个池的 NSFW 库，让名单里有两个 NSFW 池
async function addSecondNsfw(e) {
    const d = e.doc;
    setSelect(e.win, d.querySelector("#adr044-cd-import-slot"), "nsfw"); await tick(30);
    d.querySelector("#adr044-cd-lib-name").value = "情欲二库";
    d.querySelector("#adr044-cd-lib-editor").value = "## 丁\nM1\nM2\nM3\nM4\nM5";
    tapFast(e.win, d.querySelector("#adr044-cd-lib-save")); await tick(150);
}
const pools = e => e.draws.map(x => String(x["卡池"]));

(async () => {
    section("纯函数 · 闸与审核识别");
    {
        const e = build({});
        const T = e.win.__adrCdTest;
        ok(T.nsfwGate(true, false) && T.nsfwGate(true, false).hardExclude[0] === "nsfw", "三格全开且降级：NSFW 仍闸");
        ok(T.nsfwGate(true, true) === null, "只开 NSFW 且降级：不闸（旧版闸上＝永远空过）");
        ok(T.nsfwGate(false, false) === null, "没降级：不闸");
        ok(T.isModerationError(new Error("择池 API 400：{\"error\":{\"message\":\"Content Exists Risk\"}}")), "DeepSeek「Content Exists Risk」认作审核");
        ok(T.isModerationError(new Error("择卡 API 400：content_filter triggered")), "content_filter 认作审核");
        ok(T.isModerationError(new Error("择池被内容审核拦下（finish_reason=content_filter）")), "200 空答复带 finish_reason=content_filter 认作审核");
        ok(!T.isModerationError(new Error("mock DS down")), "网络断不算审核");
        ok(!T.isModerationError(new Error("择池超时（8s）")), "超时不算审核");
        ok(!T.isModerationError(new Error("点池答复无效：此刻不投卡")), "答复格式不对不算审核");
        ok(!T.isModerationError(new Error("择池 API 500：unsafe upstream")), "5xx 带 unsafe 字样也不算（不是审核，是挂了）");
        ok(!T.isModerationError(new Error("择池 API 400：model not found")), "普通 400 不算审核");
        e.stop();
    }

    section("只开 NSFW · 盲抽照常（回归）");
    {
        const e = await bootPick({ n: 1, mode: "blind" }); await nsfwOnly(e);
        for (let i = 0; i < 4; i++) await beat(e);
        ok(e.draws.length >= 3 && pools(e).every(p => p.indexOf("NSFW·") === 0), "盲抽只开 NSFW 张张都是 NSFW", pools(e).join("、"));
        ok(e.calls.length === 0, "盲抽不发一次调用");
        e.stop();
    }

    section("只开 NSFW · 择池 · 名单只有一个池就不问小眼睛");
    {
        const e = await bootPick({ n: 1, mode: "pick" }); await nsfwOnly(e);
        e.win.fetch = MOD400;   // 就算问了也会被打回——所以根本不该问
        for (let i = 0; i < 4; i++) await beat(e);
        ok(e.draws.length >= 3 && pools(e).every(p => p === "NSFW·丙"), "张张投出（旧版：永远空过）", pools(e).join("、"));
        ok(e.logs.some(l => /名单只有一个池，不问小眼睛/.test(l)), "日志说明没问小眼睛");
        ok(!e.draws.some(x => /降级/.test(String(x["模式"]))), "不算降级", e.draws.map(x => x["模式"]).join("、"));
        const line = e.doc.querySelector("#adr044-cd-status-line");
        ok(line && !/随机给的/.test(line.textContent), "状态行不报「随机给的」");
        e.stop();
    }

    section("只开 NSFW · 择卡 · 候选只有一张就不问小眼睛");
    {
        const e = await bootPick({ n: 1, mode: "pickcard" }); await nsfwOnly(e);
        e.win.fetch = MOD400;
        for (let i = 0; i < 4; i++) await beat(e);
        ok(e.draws.length >= 3 && pools(e).every(p => p === "NSFW·丙"), "张张投出", pools(e).join("、"));
        ok(e.logs.some(l => /候选只有一张，不问小眼睛/.test(l)), "日志说明没问小眼睛");
        e.stop();
    }

    section("只开 NSFW · 两个 NSFW 池 · 择池会问，但不注入硬门；答废话也照投");
    {
        const e = await bootPick({ n: 1, mode: "pick" }); await addSecondNsfw(e); await nsfwOnly(e);
        e.setScript(() => "此刻不投卡");
        for (let i = 0; i < 4; i++) await beat(e);
        ok(e.calls.length >= 3, "两个池时问了小眼睛", "calls=" + e.calls.length);
        const sys = e.calls[0] ? e.calls[0].sys : "";
        ok(!/双向规则|例外通道/.test(sys), "名单全是 NSFW 时不注入双向硬门（旧版注入＝自相矛盾）");
        ok(/必须从名单中选出一个卡池/.test(sys), "「必须选一个」照旧");
        ok(e.calls[0].user.indexOf("NSFW·丙") >= 0 && e.calls[0].user.indexOf("NSFW·丁") >= 0, "名单里两个 NSFW 池都在");
        ok(e.draws.length >= 3 && pools(e).every(p => p.indexOf("NSFW·") === 0), "答废话降级盲抽，NSFW 不再被闸（旧版空过）", pools(e).join("、"));
        ok(e.draws.every(x => /降级/.test(String(x["模式"]))), "如实记成降级");
        e.stop();
    }

    section("只开 NSFW · 两个 NSFW 池 · 小眼睛乖乖点池就按它的");
    {
        const e = await bootPick({ n: 1, mode: "pick" }); await addSecondNsfw(e); await nsfwOnly(e);
        e.setScript(() => "NSFW·丁");
        for (let i = 0; i < 3; i++) await beat(e);
        ok(e.draws.length >= 2 && pools(e).every(p => p === "NSFW·丁"), "点哪个池就投哪个池", pools(e).join("、"));
        e.stop();
    }

    section("三格全开 · 择池 · 审核打回按门已开处理");
    {
        const e = await bootPick({ n: 1, mode: "pick" });
        e.win.fetch = MOD400;
        for (let i = 0; i < 6; i++) await beat(e);
        ok(e.draws.length >= 4 && pools(e).every(p => p.indexOf("NSFW·") === 0), "审核打回时张张 NSFW（旧版张张不是 NSFW）", pools(e).join("、"));
        ok(e.draws.every(x => /审核判 NSFW/.test(String(x["模式"]))), "模式记成「审核判 NSFW」", e.draws.map(x => x["模式"]).join("、"));
        ok(e.logs.some(l => /审核把这一楼打回了/.test(l)), "日志说明为什么给了 NSFW");
        const line = e.doc.querySelector("#adr044-cd-status-line");
        ok(line && /被审核打回/.test(line.textContent), "状态行出声", line && line.textContent);
        e.stop();
    }

    section("三格全开 · 择卡 · 审核打回同理");
    {
        const e = await bootPick({ n: 1, mode: "pickcard" });
        e.win.fetch = MOD400;
        for (let i = 0; i < 5; i++) await beat(e);
        ok(e.draws.length >= 3 && pools(e).every(p => p.indexOf("NSFW·") === 0), "择卡审核打回也走 NSFW", pools(e).join("、"));
        e.stop();
    }

    section("三格全开 · 择池 · 网络断／超时／答废话仍排除 NSFW（老规矩不变）");
    {
        const e = await bootPick({ n: 1, mode: "pick" });
        e.setFail(true);
        for (let i = 0; i < 10; i++) await beat(e);
        ok(e.draws.length >= 6 && pools(e).every(p => p.indexOf("NSFW·") !== 0), "小眼睛挂了：一张 NSFW 都没有", pools(e).join("、"));
        e.stop();
        const e2 = await bootPick({ n: 1, mode: "pick" });
        e2.setScript(() => "胡说八道");
        for (let i = 0; i < 10; i++) await beat(e2);
        ok(e2.draws.length >= 6 && pools(e2).every(p => p.indexOf("NSFW·") !== 0), "答废话：一张 NSFW 都没有", pools(e2).join("、"));
        e2.stop();
    }

    section("三格全开 · 择池 · 名单有别的仓库时硬门照旧注入");
    {
        const e = await bootPick({ n: 1, mode: "pick" });
        e.setScript(() => "通用·乙");
        await beat(e); await beat(e);
        const sys = e.calls[0] ? e.calls[0].sys : "";
        ok(/双向规则/.test(sys) && /例外通道/.test(sys), "三格全开时双向硬门原样在");
        e.stop();
    }

    console.log("\n════════════════════════════════");
    console.log("通过 " + PASS + " · 失败 " + FAIL);
    if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
    console.log("════════════════════════════════");
    process.exit(FAIL ? 1 : 0);
})();
