const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
for (const relative of ['apps/api', 'apps/web', 'packages/shared']) {
  const target = path.join(root, relative);
  const name = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).name;
  if (!/^@apply-lite\/[a-z-]+$/.test(name)) throw new Error('Unexpected workspace name');
  const link = path.join(root, 'node_modules', name);
  let stat; try { stat = fs.lstatSync(link); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat && !stat.isSymbolicLink()) throw new Error('Refusing to replace a non-link workspace directory');
  if (stat) fs.unlinkSync(link);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
console.log('Workspace links verified at the final installation path.');
