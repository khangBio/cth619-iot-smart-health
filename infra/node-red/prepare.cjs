const fs = require('node:fs');
// The image can seed root-owned files in the writable /data volume.
// Replace entries atomically instead of opening those files for overwrite.
const replace = (name, content, mode = 0o600) => {
  const target = `/data/${name}`;
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode });
  fs.renameSync(temporary, target);
};
const read = (file, fallback) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const existing = read('/data/flows.json', []);
const credentials = read('/data/flows_cred.json', {});
if (!Array.isArray(existing)) throw new Error('flows.json must be an array; migration cancelled');
// Preserve the user's original flows and credentials before first migration.
if (existing.length && !fs.existsSync('/data/flows.before-flowfuse.json')) {
  replace('flows.before-flowfuse.json', JSON.stringify(existing, null, 2));
  replace('flows_cred.before-flowfuse.json', JSON.stringify(credentials));
}
const integration = read('/config/flows.json', []);
const dashboard = require('./build-dashboard.cjs').dashboardNodes();
const owned = new Set(integration.map((n) => n.id));
const extra = existing.filter((n) => !owned.has(n.id) && !n.id.startsWith('ff-health-'));
const merged = integration.map((node) => {
  const previous = existing.find((n) => n.id === node.id);
  if (!node.wires || !previous?.wires) return node;
  // Keep user-added debug taps attached to the managed integration nodes.
  return {
    ...node,
    wires: node.wires.map((w, i) => [...new Set([...w, ...(previous.wires[i] || [])])]),
  };
});
replace('flows.json', JSON.stringify([...merged, ...extra, ...dashboard], null, 2));
replace(
  'flows_cred.json',
  JSON.stringify({
    ...credentials,
    broker: { user: 'platform', password: process.env.MQTT_PASSWORD },
  })
);
