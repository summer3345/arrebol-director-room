// Run: node test_theme.js. No DOM package or network required.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/index.js', 'utf8');
const names = ['adr048IsDarkPalette', 'adr048Palette', 'adr048NextPalette', 'adr048FabTheme', 'adr048ApplyFabTheme', 'adr048ApplyPanelTheme', 'adr048BindPopupPanel'];
// v1.31.0+ keeps the palette tables as plain vars next to the functions; lift them too.
const tables = ['ADR_PALETTES', 'ADR_DARK_PALETTES', 'ADR_PALETTE_LABEL', 'ADR_PALETTE_ICON'].map(name => {
    const m = source.match(new RegExp('^    var ' + name + ' = .*$', 'm'));
    assert.ok(m, name);
    return m[0];
}).join('\n');
const code = tables + '\n' + names.map(name => {
    const start = source.indexOf('    function ' + name + '(');
    assert.ok(start >= 0, name);
    const next = source.indexOf('\n    function ', start + 1);
    return source.slice(start, next < 0 ? undefined : next);
}).join('\n');
function element() {
    return { attrs: {}, handlers: {}, textContent: '', title: '',
        setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
        addEventListener(k, fn) { (this.handlers[k] ||= []).push(fn); } };
}
function setup(initial) {
    let st = { ...initial }, persisted, writes = 0;
    const els = Object.fromEntries(['adr048-popup-panel', 'adr048-popup-shell', 'adr048-theme-toggle', 'adr048-fab', 'adr044-drawer'].map(id => ['#' + id, element()]));
    els['#adr048-popup-panel'].attrs['data-open'] = '1';
    const ctx = vm.createContext({ settings: () => st, rootDoc: () => ({ querySelector: id => els[id] || null }),
        save: (k,v) => { st[k] = v; }, saveNow: () => { persisted = JSON.stringify(st); writes++; },
        adr048SetImportant: (el,k,v) => el.setAttribute('style:' + k,v) });
    vm.runInContext(code, ctx);
    return { ctx, els, state: () => st, persisted: () => persisted, writes: () => writes };
}
for (const [initial, expected] of [[{},'dusk'],[{dawnTheme:false},'dusk'],[{dawnTheme:true},'sunset'],[{themePalette:'unknown',dawnTheme:true},'sunset']]) {
    const e = setup(initial); assert.equal(e.ctx.adr048Palette(),expected);
}
const e = setup({dawnTheme:true});
e.ctx.adr048ApplyPanelTheme(); e.ctx.adr048BindPopupPanel(); e.ctx.adr048BindPopupPanel();
const btn = e.els['#adr048-theme-toggle'];
assert.equal(btn.handlers.click.length,1);
assert.equal(btn.handlers.touchend,undefined, 'touch uses native click, never a second advance');
// Six-station cycle from the migrated sunset: pearl → celadon → wine → morandi → dusk → sunset.
for (const [palette, label] of [['pearl','雾珠月汐'],['celadon','天青如梦'],['wine','暗河红霞'],['morandi','莫兰迪烟粉'],['dusk','暗河夜色'],['sunset','粉霞水光']]) {
    btn.handlers.click[0]({preventDefault(){},stopPropagation(){}});
    assert.equal(e.state().themePalette,palette);
    assert.equal(e.state().dawnTheme,palette !== 'dusk');
    assert.equal(e.els['#adr048-popup-panel'].attrs['data-adr-palette'],palette);
    assert.equal(e.els['#adr048-fab'].attrs['data-adr-palette'],palette);
    assert.equal(e.els['#adr044-drawer'].attrs['data-adr-palette'],palette);
    assert.equal(e.els['#adr048-fab'].attrs['data-arb-theme'],(palette === 'dusk' || palette === 'wine') ? 'dusk' : 'dawn');
    assert.ok(btn.attrs['aria-label'].includes(label));
    const reloaded = setup(JSON.parse(e.persisted()));
    reloaded.ctx.adr048ApplyPanelTheme();
    assert.equal(reloaded.ctx.adr048Palette(),palette);
    assert.equal(reloaded.writes(),0, 'rendering does not save or alter preferences');
}
assert.equal(e.writes(),6);
const noFab = setup({themePalette:'pearl'});delete noFab.els['#adr048-fab'];
noFab.ctx.adr048ApplyFabTheme();assert.equal(noFab.els['#adr044-drawer'].attrs['data-adr-palette'],'pearl');
console.log('PASS: legacy preference migration, six-way cycle, single touch/click activation, persistence, labels, panel/drawer/fab sync and hidden-fab handling.');
