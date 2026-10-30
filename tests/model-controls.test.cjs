'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {selectionFor, optionsFor, layoutFor} = require('../common/model-controls.cjs');

function trigger(base, effort) {
  const suffix = effort ? {textContent: effort} : null;
  return {querySelector: () => ({childNodes: [{nodeType: 3, textContent: base}, ...(suffix ? [{nodeType: 1, textContent: effort}] : [])], querySelector: () => suffix})};
}
test('effort capability requires the native separate span, including context-window labels', () => {
  assert.equal(selectionFor(trigger('Gemini Flash', ' High · 1M')).effortLabel, 'High');
  for (const name of ['Claude (Thinking)', 'GPT-OSS (Medium)', 'Custom High model'])
    assert.equal(selectionFor(trigger(name)).effortLabel, '');
  assert.equal(selectionFor(null), null);
});
function menuFixture(entries) {
  const menu = {querySelectorAll: () => labels};
  const labels = entries.map(entry => {
    const row = {closest: () => menu, hasAttribute: name => name === 'aria-haspopup' ? !!entry.context : name === 'data-disabled' && !!entry.disabled,
      getAttribute: name => name === 'aria-checked' ? String(!!entry.selected) : null};
    return {dataset: {effort: entry.value}, textContent: entry.label || entry.value, closest: () => row};
  });
  return menu;
}
test('slider detents come only from enabled native options and retain their native ordering', () => {
  const menu = menuFixture([{value:'minimal'},{value:'low',disabled:true},{value:'custom_deep',label:'Deep',selected:true}]);
  assert.deepEqual(optionsFor(menu).map(({value,label,selected}) => ({value,label,selected})), [
    {value:'minimal',label:'minimal',selected:false}, {value:'custom_deep',label:'Deep',selected:true}
  ]);
});
test('ambiguous, fixed and context-window menus keep the native UI', () => {
  for (const entries of [[],[{value:'high'}],[{value:'low'},{value:'low'}],[{value:'low'},{value:'high',context:true}],[{value:'low'},{value:'../high'}]])
    assert.deepEqual(optionsFor(menuFixture(entries)), []);
});
test('toolbar flattening is limited to the shared native composer footer', () => {
  const footer = {classList:{contains:name=>name==='@container/input-footer'},contains:node=>node===permission};
  const left = {parentElement:footer,classList:{contains:()=>false}}, right = {parentElement:footer};
  const tail = {}, model = {parentElement:left}, permission = {parentElement:right};right.children=[permission,tail];
  const layout = layoutFor(model, permission);
  assert.equal(layout.footer, footer);assert.deepEqual(layout.flatten,[left,right]);assert.deepEqual(layout.tail,[tail]);
  assert.equal(layoutFor(model,{parentElement:{}}),null);
});
