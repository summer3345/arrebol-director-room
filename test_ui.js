// v1.29.3: layout changes must keep settings, counters and both panel surfaces in sync.
// v1.31.0: four-palette cycle (sunset → pearl → celadon → dusk) keeps panel, drawer and fab in step.
// Run: npm install --no-save jsdom && node test_ui.js
const fs = require('fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const KEY = 'arrebol-d-final-v1040-stable-settings';
const source = fs.readFileSync('index.js', 'utf8').replace('    wait();',
    '    window.uiTest = { init, switchTab, adrDUpdateAutoCounters, adr048OpenPopupPanel, adr048ClosePopupPanel, adr048ApplyPanelTheme, adr048FabTheme, adr048ApplyFabTheme };');
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function check(condition, name) { assert.ok(condition, name); console.log('✓ ' + name); passed++; }
function build() {
    const dom = new JSDOM('<!doctype html><html><body><div id="extensions_settings2"></div></body></html>',
        { url: 'https://example.org/', pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window, d = w.document, chat = [], handlers = {};
    const extensionSettings = { [KEY]: { activeTab: 'emotion', dawnTheme: true, autoTriggerEmotion: true,
        autoTriggerPlot: true, autoTriggerEmotionRange: 'custom', autoTriggerEmotionCustomRange: 17,
        autoTriggerPlotRange: '30', cdEnabled: true, cdN: 5, supplementMemory: '原始记忆', streamEnabled: false } };
    const chatMetadata = { arrebol_d: { v: 1, auto: { emotion: { base: 30, mode: 'full-chat-v1' }, plot: { base: 24, mode: 'full-chat-v1' } } },
        arrebol_d_cd: { lastDrawAt: 32, history: [] } };
    for (let i = 0; i < 34; i++) chat.push({ is_user: true, mes: '继续' }, { is_user: false, mes: '<content>灯亮了。</content>' });
    const timers = [];
    const nativeInterval = w.setInterval.bind(w);
    w.setInterval = (fn, ms) => { timers.push({ fn, ms }); return nativeInterval(fn, ms); };
    let requests = 0;
    w.fetch = async () => { requests++; throw Error('No network in UI tests'); };
    w.toastr = { success() {}, info() {}, error() {}, warning() {} };
    const context = { extensionSettings, chatMetadata, chat, chatId: 'ui-test', getCurrentChatId: () => 'ui-test',
        saveSettingsDebounced() {}, saveSettings() {}, saveMetadataDebounced() {}, saveMetadata() {},
        extensionPrompts: {}, setExtensionPrompt() {}, extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: s => s, eventSource: { on(t, f) { (handlers[t] ||= []).push(f); } },
        event_types: { APP_READY: 'app_ready', MESSAGE_RECEIVED: 'message_received', CHAT_CHANGED: 'chat_changed' } };
    w.SillyTavern = { getContext: () => context };
    w.eval(source); w.uiTest.init();
    return { w, d, chat, extensionSettings, chatMetadata, timers, requests: () => requests, close: () => dom.window.close() };
}
(async () => {
    const e = build(), { w, d } = e;
    try {
        await delay(450);
        w.uiTest.adr048OpenPopupPanel(); await delay(200);
        const root = () => d.querySelector('#adr048-popup-body');
        const drawer = d.querySelector('#adr044-drawer .adr044-box');
        const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        const counter = (scope, type) => scope.querySelector('#adr044-auto-counter-' + type);
        for (const [name, scope] of [['浮窗', root()], ['抽屉', drawer]]) {
            check(scope.firstElementChild.id === 'adr044-master-toggle', name + '第一项为运行总开关');
            check(scope.firstElementChild.nextElementSibling.classList.contains('adr-top-tabs'), name + '总开关后为导演切换');
            check(scope.querySelector('.adr-top-tabs').nextElementSibling.classList.contains('adr-top-progress'), name + '进度紧跟切换');
            check(!scope.querySelector('[data-drawer-id="shared-main"]').open, name + '共享设置默认收起');
            for (const type of ['emotion', 'plot']) {
                for (const kind of ['api', 'preset']) {
                    const fold = scope.querySelector('[data-drawer-id="' + kind + '-' + type + '"]');
                    check(fold?.tagName === 'DETAILS' && !fold.open, name + type + kind + '默认折叠');
                }
                const calibrate = scope.querySelector('#adr044-' + type + '-calibrate-auto');
                check(calibrate.closest('.adr-top-pane')?.dataset.director === type && !calibrate.closest('details'), name + type + '对表在顶部且无需展开');
            }
            for (const key of ['slots', 'library', 'api', 'envelope', 'help']) {
                check(!scope.querySelector('[data-drawer-id="cd-' + key + '"]').open, name + '抽卡' + key + '默认收起');
            }
            check(scope.querySelector('[data-drawer-id="cd-controls"]').open && scope.querySelector('[data-drawer-id="cd-current"]').open, name + '抽卡常用操作和当前卡片默认展开');
            const ids = [...scope.querySelectorAll('[id]')].map(el => el.id);
            check(new Set(ids).size === ids.length, name + '内部没有新增重复 ID');
            check(counter(scope, 'emotion').querySelector('.arb-ct-nums b').textContent === '4', name + '原有情感进度 4/17 保留');
            check(counter(scope, 'plot').querySelector('.arb-ct-nums b').textContent === '10', name + '原有统筹进度 10/30 保留');
            check(counter(scope, 'cd').querySelector('.arb-ct-nums b').textContent === '2', name + '抽卡按原 lastDrawAt 显示 2/5');
        }
        const before = JSON.stringify(e.chatMetadata);
        for (const type of ['plot', 'cd', 'emotion']) {
            root().scrollTop = 600;
            click(root().querySelector('#adr044-tab-' + type));
            for (const scope of [root(), drawer]) {
                const panes = [...scope.querySelectorAll('.adr-top-pane')].filter(el => !el.hidden);
                check(panes.length === 1 && panes[0].dataset.director === type, '切到 ' + type + ' 时两端进度对应当前页');
                check(scope.querySelector('#adr044-tab-' + type).getAttribute('aria-pressed') === 'true', type + ' 导航辅助状态同步');
            }
            check(root().scrollTop === 0, '切到 ' + type + ' 返回顶部，避免停在上一页中部');
        }
        w.uiTest.adrDUpdateAutoCounters();
        check(JSON.stringify(e.chatMetadata) === before, '切页与计数展示不改两位导演和抽卡的基准线');
        let details = counter(root(), 'emotion').querySelector('.adr-counter-details');
        details.open = true;
        const current = counter(root(), 'emotion').firstElementChild;
        w.uiTest.adrDUpdateAutoCounters();
        check(counter(root(), 'emotion').firstElementChild === current, '无变化的刷新不重建进度 DOM');
        e.chat.push({ is_user: true, mes: '继续' }, { is_user: false, mes: '<content>天亮了。</content>' });
        w.uiTest.adrDUpdateAutoCounters();
        check(counter(root(), 'emotion').querySelector('.arb-ct-nums b').textContent === '5', '新楼数显示为 5/17');
        check(counter(root(), 'emotion').querySelector('.adr-counter-details').open, '进度更新仍保留展开的计数详情');
        check(counter(root(), 'emotion').querySelector('[role="progressbar"]').getAttribute('aria-valuenow') === '5', '进度辅助读数更新');
        check(JSON.stringify(e.chatMetadata) === before, '单纯更新显示不落盘');
        const shared = root().querySelector('[data-drawer-id="shared-main"]');
        shared.open = true;
        const memory = root().querySelector('#adr044-memory');
        memory.value = '修改后的共享记忆';
        memory.dispatchEvent(new w.Event('input', { bubbles: true }));
        memory.dispatchEvent(new w.Event('change', { bubbles: true }));
        await delay(650);
        check(e.extensionSettings[KEY].supplementMemory === '修改后的共享记忆', '折叠后的共享设置仍自动保存');
        const range = root().querySelector('#adr044-auto-trigger-range-emotion');
        const plotBase = e.chatMetadata.arrebol_d.auto.plot.base;
        range.value = '10'; range.dispatchEvent(new w.Event('change', { bubbles: true }));
        await delay(80);
        check(e.extensionSettings[KEY].autoTriggerEmotionRange === '10', '移到顶部的触发间隔仍保存');
        check(drawer.querySelector('#adr044-auto-trigger-range-emotion').value === '10', '触发间隔两端镜像同步');
        check(root().querySelector('#adr044-auto-trigger-custom-emotion').style.display === 'none', '非自定义间隔隐藏自定义输入');
        check(e.chatMetadata.arrebol_d.auto.plot.base === plotBase, '修改情感间隔不动统筹基准线');
        w.uiTest.switchTab('cd');
        const pause = root().querySelector('#adr044-cd-paused');
        pause.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
        click(pause); await delay(100);
        check(counter(root(), 'cd').textContent.includes('已暂停'), '暂停投卡立即反映在顶部');
        check(e.chatMetadata.arrebol_d_cd.lastDrawAt === 32, '暂停显示不改变抽卡进度');
        w.uiTest.adr048ClosePopupPanel(); w.uiTest.adr048OpenPopupPanel(); await delay(150);
        check(root().querySelector('[data-drawer-id="shared-main"]').open, '重新打开浮窗保留共享设置展开状态');
        check(root().querySelector('#adr044-memory').value === '修改后的共享记忆', '重新打开浮窗保留编辑内容');
        check(root().querySelector('.adr-top-pane:not([hidden])').dataset.director === 'cd', '重新打开保留当前页');
        check(!root().querySelector('#adr044-stream-enabled').checked, '改版保留原流式开关');
        // v1.32.0: five palettes cycle sunset → pearl → celadon → wine → dusk → sunset; wine is the second dark palette.
        // v1.35.0: six palettes — morandi (light) sits between wine and dusk.
        // v1.36.0: seven palettes — skyrose (light) follows morandi.
        const panel = () => d.querySelector('#adr048-popup-panel');
        const fabEl = () => d.querySelector('#adr048-fab');
        check(panel().dataset.adrPalette === 'sunset' && panel().dataset.arbTheme === 'dawn', '旧版开灯设置对应粉霞水光');
        for (const [pal, theme] of [['pearl', 'dawn'], ['celadon', 'dawn'], ['wine', 'dusk'], ['morandi', 'dawn'], ['skyrose', 'dawn'], ['dusk', 'dusk'], ['sunset', 'dawn']]) {
            click(d.querySelector('#adr048-theme-toggle')); await delay(50);
            check(panel().dataset.adrPalette === pal && panel().dataset.arbTheme === theme, '切到 ' + pal + '：面板配色与明暗属性正确');
            check(fabEl().dataset.adrPalette === pal && fabEl().dataset.arbTheme === theme, '切到 ' + pal + '：浮标同步');
            check(drawer.closest('#adr044-drawer').dataset.adrPalette === pal, '切到 ' + pal + '：内嵌抽屉同步');
            check(e.extensionSettings[KEY].themePalette === pal, '切到 ' + pal + '：设置已保存');
        }
        check(d.querySelector('#adr048-theme-toggle').title.indexOf('粉霞水光') >= 0 && d.querySelector('#adr048-theme-toggle').title.indexOf('雾珠月汐') >= 0, '主题按钮提示写明当前与下一套');
        for (let i = 0; i < 6; i++) click(d.querySelector('#adr048-theme-toggle'));
        await delay(50);
        check(panel().dataset.arbTheme === 'dusk' && panel().dataset.adrPalette === 'dusk', '主题切换仍可用');
        const settings = e.extensionSettings[KEY];
        const fab = d.querySelector('#adr048-fab');
        const svg = fab.firstElementChild;
        const position = [fab.style.left, fab.style.top, fab.style.right, fab.style.bottom].join('|');
        // Upgrade from v1.29.0 must also follow the panel without manual migration.
        settings.fabThemeMode = 'clock';
        w.uiTest.adr048ApplyFabTheme();
        check(fab.dataset.arbTheme === 'dusk', '旧版时钟设置不再干扰浮标，夜间面板即夜色');
        click(d.querySelector('#adr048-theme-toggle'));
        check(fab.dataset.arbTheme === 'dawn', '太阳按钮立即同步浮标日色');
        check(w.uiTest.adr048FabTheme({ getHours: () => 23 }) === 'dawn', '晚上也尊重用户选择的日间面板');
        for (let i = 0; i < 3; i++) click(d.querySelector('#adr048-theme-toggle'));
        check(fab.dataset.arbTheme === 'dusk' && fab.dataset.adrPalette === 'wine', '红霞属深色组：浮标同步夜色底');
        click(d.querySelector('#adr048-theme-toggle'));
        check(fab.dataset.arbTheme === 'dawn' && fab.dataset.adrPalette === 'morandi', '烟粉属浅色组：浮标同步日色底');
        check(d.querySelector('#adr048-theme-toggle').textContent === '🎀' && d.querySelector('#adr048-theme-toggle').title.indexOf('莫兰迪烟粉') >= 0, '烟粉图标与提示');
        click(d.querySelector('#adr048-theme-toggle'));
        check(fab.dataset.arbTheme === 'dawn' && fab.dataset.adrPalette === 'skyrose', '晴空属浅色组：浮标同步日色底');
        check(d.querySelector('#adr048-theme-toggle').textContent === '🌤️' && d.querySelector('#adr048-theme-toggle').title.indexOf('晴空粉霞') >= 0, '晴空图标与提示');
        click(d.querySelector('#adr048-theme-toggle'));
        check(fab.dataset.arbTheme === 'dusk' && fab.dataset.adrPalette === 'dusk', '月亮按钮立即同步浮标夜色');
        check(!root().querySelector('#adr044-fab-theme-mode'), '不再显示容易混淆的时钟设置');
        check(e.timers.filter(t => t.ms === 60000).length === 0, '不安装浮标时钟轮询');
        check(fab.firstElementChild === svg, '换色不重建浮标，不丢拖动监听');
        check([fab.style.left, fab.style.top, fab.style.right, fab.style.bottom].join('|') === position, '换色保留浮标位置');
        check(!!fab.querySelector('.arb-fab-current'), '浮标恢复沿小波浪流动的高光');
        // Folding preserves edited values and remembered state after rebuilding the popup.
        const folds = ['api-emotion', 'preset-emotion', 'cd-api', 'cd-library', 'cd-envelope'];
        for (const key of folds) root().querySelector('[data-drawer-id="' + key + '"]').open = true;
        w.uiTest.switchTab('emotion');
        const model = root().querySelector('#adr044-emotion-model');
        model.value = 'ui-fold-model';
        model.dispatchEvent(new w.Event('change', { bubbles: true }));
        await delay(650);
        w.uiTest.adr048ClosePopupPanel(); w.uiTest.adr048OpenPopupPanel(); await delay(150);
        for (const key of folds) check(root().querySelector('[data-drawer-id="' + key + '"]').open, key + '重新打开保留展开状态');
        check(root().querySelector('#adr044-emotion-model').value === 'ui-fold-model', '折叠 API 配置仍能保存模型');
        check(!root().querySelector('#adr044-emotion-preview').closest('.adr-fold-card'), '导演结果保持直接可见');
        root().querySelector('[data-drawer-id="trigger-emotion"]').open = false;
        const baselineBefore = e.chatMetadata.arrebol_d.auto.emotion.base;
        const plotBefore = e.chatMetadata.arrebol_d.auto.plot.base;
        const cdBefore = e.chatMetadata.arrebol_d_cd.lastDrawAt;
        const calibrate = root().querySelector('#adr044-emotion-calibrate-auto');
        click(calibrate); await delay(500);
        check(e.chatMetadata.arrebol_d.auto.emotion.base === baselineBefore && calibrate.textContent === '确定对表？', '顶部对表第一次点击仍仅确认');
        click(calibrate); await delay(150);
        check(e.chatMetadata.arrebol_d.auto.emotion.base === 35, '触发设置收起时仍能对表至当前楼层');
        check(counter(root(), 'emotion').querySelector('.arb-ct-nums b').textContent === '0' && counter(drawer, 'emotion').querySelector('.arb-ct-nums b').textContent === '0', '对表后两端进度都归零');
        check(e.chatMetadata.arrebol_d.auto.plot.base === plotBefore && e.chatMetadata.arrebol_d_cd.lastDrawAt === cdBefore, '情感对表不改统筹或抽卡基准线');
        check(e.requests() === 0, '全部 UI 操作没有发送 API 请求');
        console.log('\n通过 ' + passed + ' · 失败 0');
    } finally { e.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
