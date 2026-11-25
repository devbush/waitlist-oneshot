// Audit harness: the snapshot tests call listen(0); remap to the allowed 4120-4129 range.
import net from 'node:net';
let next = 4120;
const orig = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (args[0] === 0) args[0] = next++;
  return orig.apply(this, args);
};
