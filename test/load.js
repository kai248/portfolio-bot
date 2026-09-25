// Loads the .gs files into one shared sandbox, the way Apps Script does.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function load(files, extraGlobals) {
  const ctx = vm.createContext(Object.assign({ console }, extraGlobals || {}));
  files.forEach(f => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  });
  return ctx;
};
