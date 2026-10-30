const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/app.js'), 'utf8');
for (const [name, end, pane] of [['setupListResizer', 'function setupContextResizer', 'entry'], ['setupContextResizer', '/* ---------- Events ---------- */', 'agent']]) {
  test(`${pane} separator owns resize keys without bubbling to article navigation`, () => {
    const handlers = {};
    const changes = [];
    const resizer = { addEventListener(type, fn) { handlers[type] = fn; } };
    const node = { getBoundingClientRect: () => ({ width: 320 }), classList: { add() {}, remove() {} } };
    const context = { $: s => s.endsWith('resizer') ? resizer : node, window: { addEventListener() {} }, state: { entryPaneWidth: 320, contextPaneWidth: 320 }, entryPaneWidthBounds: () => ({ min: 240, max: 500 }), contextPaneWidthBounds: () => ({ min: 240, max: 500 }), setEntryPaneWidth: x => changes.push(x), setContextPaneWidth: x => changes.push(x) };
    const code = source.slice(source.indexOf(`function ${name}()`), source.indexOf(end, source.indexOf(`function ${name}()`)));
    vm.runInNewContext(code + `\n${name}();`, context);
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      let prevented = false, stopped = false;
      handlers.keydown({ key, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
      assert.equal(prevented, true, key);
      assert.equal(stopped, true, `${key} must not reach the global article navigation handler`);
    }
    assert.equal(changes.length, 4);
  });
}
